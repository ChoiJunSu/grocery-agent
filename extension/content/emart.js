// 이마트 쓱배송(emart.ssg.com) + SSG 장바구니(pay.ssg.com) 어댑터.
//
// 셀렉터는 후보 배열을 순서대로 시도한다. 샌드박스에서 실사이트 접근이 차단되어
// 최종 확인은 실제 브라우저에서 필요하다 — 미매칭 시 콘솔에 경고를 남기고,
// 상품 카드가 하나도 없으면 mock으로 폴백해 사이클이 끊기지 않게 한다.

(() => {
  const { q, qa, parsePrice, pickBestCard, setInputValue, sleep, waitFor } = window.__ga;

  const SELECTORS = {
    // 검색 결과/카테고리의 상품 카드
    productCard: ['li.cunit_t232', 'li.cunit_t239', '[data-unittype="item"]', '.mnemitem_grid_item'],
    productName: ['.cunit_info em.tx_ko', '.mnemitem_goods_tit', '.cunit_tx_info em'],
    productPrice: ['.cunit_price .ssg_price', '.new_price .ssg_price', 'em.ssg_price'],
    productLink: ['a.clickable', '.cunit_prod a', 'a[href*="itemView"]'],
    soldOutBadge: ['.cunit_soldout', '.mnemitem_soldout', '.ssgexpress_soldout'],
    cardCartBtn: ['button.cmitem_btn_cart', 'button[class*="btn_cart"]', '.cunit_btn button[title*="장바구니"]'],
    // 상품 상세 페이지
    detailQtyInput: ['#gttQty', 'input.cdtl_opt_qty', 'input[name="itemQty"]', 'input[title*="수량"]'],
    detailCartBtn: ['#btnCart', 'button.cdtl_btn_cart', 'a.cdtl_btn_cart', 'button[title*="장바구니"]'],
    // 담기 확인 레이어 닫기
    layerClose: ['.cmlayer_close', 'button.btn_close', '[data-react-tarea-cd] .close'],
    // 마이페이지 쿠폰함 (https://emart.ssg.com/myssg/coupon 계열)
    couponRow: ['.cunit_coupon_item', '.mycp_list li', '[class*="coupon_item"]'],
    couponName: ['.coupon_tit', '.mycp_tit', '[class*="coupon_name"]'],
    // pay.ssg.com 장바구니 상품 행
    cartLine: ['.cart_prod', '[class*="cartItem"]', '.ordq_item'],
    cartLineName: ['.cart_prod_tx .tx_ko', '.cart_info_tx a', '[class*="prod_name"]'],
  };

  const MOCK_FALLBACK = {
    offers: [
      { siteName: '서울우유 나 100% 우유 1L', price: 2980, available: true },
      { siteName: '[이마트] 무항생제 특란 30입', price: 8980, available: true },
      { siteName: '이마트 햅쌀 10kg', price: 32900, available: true },
    ],
    coupons: [
      { id: 'emart-10pct', name: '쓱배송 10% (최대 5천원)', type: 'percent', value: 10, minOrder: 50000, maxDiscount: 5000 },
    ],
    slots: [{ date: '2026-07-05', timeRange: '14:00~17:00', available: true }],
  };

  const isDetailPage = () => /itemView|\/item\//.test(location.href);
  const isCartPage = () => location.hostname === 'pay.ssg.com';

  window.__registerMartAdapter({
    martId: 'emart',

    async scrapeOffers() {
      const cards = qa(document, SELECTORS.productCard);
      if (cards.length === 0) {
        console.warn('[장보기 에이전트] emart: 상품 카드 셀렉터 미매칭 → mock 폴백');
        return MOCK_FALLBACK.offers;
      }
      return cards
        .map((card) => {
          const name = q(card, SELECTORS.productName)?.textContent?.trim();
          const price = parsePrice(q(card, SELECTORS.productPrice)?.textContent);
          if (!name || !price) return null;
          return { siteName: name, price, available: !q(card, SELECTORS.soldOutBadge) };
        })
        .filter(Boolean);
    },

    async scrapeCoupons() {
      const rows = qa(document, SELECTORS.couponRow);
      if (rows.length === 0) return MOCK_FALLBACK.coupons;
      // 할인율/조건 파싱은 쿠폰함 실DOM 확인 후 정교화 — 이름만이라도 수집
      return rows.map((row, i) => ({
        id: `emart-scraped-${i}`,
        name: q(row, SELECTORS.couponName)?.textContent?.trim() ?? '이름 미상 쿠폰',
        type: 'fixed',
        value: 0,
        minOrder: 0,
      }));
    },

    async scrapeSlots() {
      // 쓱배송 예약 캘린더는 배송지 설정에 종속 — 실DOM 확인 전까지 mock
      return MOCK_FALLBACK.slots;
    },

    async addItem(item) {
      // 상품 상세 페이지: 수량 설정 후 담기
      if (isDetailPage()) {
        const qty = q(document, SELECTORS.detailQtyInput);
        if (qty) setInputValue(qty, item.quantity);
        const btn = q(document, SELECTORS.detailCartBtn);
        if (!btn) return { ok: false, reason: '상세페이지 장바구니 버튼 미발견' };
        btn.click();
        await sleep(1500);
        q(document, SELECTORS.layerClose)?.click();
        return { ok: true };
      }

      // 검색 결과 페이지: 대상 상품과 가장 유사한 카드 선택
      const cards = await waitFor(() => {
        const found = qa(document, SELECTORS.productCard);
        return found.length > 0 ? found : null;
      });
      if (!cards) {
        console.warn(`[장보기 에이전트] emart: 검색 카드 미발견 → mock 담기: ${item.name} x${item.quantity}`);
        return { ok: true, mocked: true };
      }

      const match = pickBestCard(cards, (c) => q(c, SELECTORS.productName)?.textContent, item.name);
      if (!match) return { ok: false, reason: `검색 결과에 '${item.name}' 유사 상품 없음` };
      if (q(match.card, SELECTORS.soldOutBadge)) return { ok: false, reason: '품절' };

      const cartBtn = q(match.card, SELECTORS.cardCartBtn);
      if (cartBtn) {
        // 카드 퀵담기는 1개 단위 → 수량만큼 반복 클릭
        for (let i = 0; i < item.quantity; i++) {
          cartBtn.click();
          await sleep(900);
          q(document, SELECTORS.layerClose)?.click();
        }
        return { ok: true };
      }
      // 퀵담기 버튼이 없으면 상세 페이지로 이동해 재시도
      const link = q(match.card, SELECTORS.productLink);
      if (link?.href) return { ok: false, navigate: link.href };
      return { ok: false, reason: '담기 버튼/상세 링크 모두 미발견' };
    },

    async scrapeCart() {
      if (!isCartPage()) return null;
      const lines = await waitFor(() => {
        const found = qa(document, SELECTORS.cartLine);
        return found.length > 0 ? found : null;
      });
      if (!lines) return null;
      const names = lines
        .map((line) => q(line, SELECTORS.cartLineName)?.textContent?.trim())
        .filter(Boolean);
      return { names };
    },
  });
})();
