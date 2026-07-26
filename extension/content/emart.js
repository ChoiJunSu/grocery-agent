// 이마트 쓱배송(emart.ssg.com) + SSG 장바구니(pay.ssg.com) 어댑터.
//
// 셀렉터는 후보 배열을 순서대로 시도한다. 어느 후보도 안 맞으면 실패로 보고한다 —
// 임의의 값으로 대신하지 않는다. 없는 데이터를 지어내면 최적화 결과가 조용히
// 틀리고, 담기지도 않은 상품이 "담김"으로 뜨기 때문이다.
// 셀렉터가 안 맞으면 SELECTORS의 해당 배열 맨 앞에 올바른 값을 추가하면 된다.

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

  const isDetailPage = () => /itemView|\/item\//.test(location.href);
  const isCartPage = () => location.hostname === 'pay.ssg.com';

  window.__registerMartAdapter({
    martId: 'emart',
    selectors: SELECTORS, // DIAGNOSE 메시지가 실페이지에서 후보별 매칭 수를 보고하는 데 사용

    async scrapeOffers() {
      const cards = qa(document, SELECTORS.productCard);
      if (cards.length === 0) {
        console.warn('[장보기 에이전트] emart: 상품 카드 셀렉터 미매칭 — 수집 0건 (SELECTORS.productCard 확인 필요)');
        return [];
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
      // 쿠폰함(https://emart.ssg.com/myssg/coupon 계열)에서만 잡힌다. 다른 페이지에선 0건이 정상.
      const rows = qa(document, SELECTORS.couponRow);
      if (rows.length === 0) return [];
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
      // 쓱배송 예약 캘린더는 배송지 설정에 종속적이라 아직 파싱하지 않는다.
      // 추정 슬롯을 내보내면 "언제 오는지"를 틀리게 알려주게 되므로 빈 배열을 반환한다.
      return [];
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
        return {
          ok: false,
          reason: '검색 결과 카드 미발견 (로그인/봇차단 페이지이거나 SELECTORS.productCard 미매칭)',
        };
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
