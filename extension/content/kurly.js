// 마켓컬리(www.kurly.com) 어댑터.
//
// 컬리는 Next.js + emotion CSS-in-JS를 쓰는 SPA다. 검색 카드에 담기 버튼이 그대로
// 노출되므로 상세 페이지 경유 없이 검색 결과에서 바로 담는다 (상세 경유는 폴백).
//
// 어느 셀렉터 후보도 안 맞으면 실패로 보고한다 — 임의의 값으로 대신하지 않는다.
// 셀렉터가 안 맞으면 SELECTORS의 해당 배열 맨 앞에 올바른 값을 추가하면 된다.

(() => {
  const { q, qa, parsePrice, pickBestCard, setInputValue, sleep, waitFor } = window.__ga;

  // 2026-07-26 실사이트(www.kurly.com/search) DOM으로 검증: 카드 96개 전부 이름+가격 추출 성공.
  // 컬리는 emotion CSS-in-JS라 css-* 해시 클래스가 배포마다 바뀐다. 따라서 해시에 기대지 않고
  // 안정적인 앵커만 쓴다 — href 패턴(/goods/), 의미 있는 클래스(.sales-price, .price-number,
  // .button-wrapper), 그리고 구조 선택자(설명 <p> 바로 앞의 <span>이 상품명).
  const SELECTORS = {
    // 검색/컬렉션 결과의 상품 카드 (카드 자체가 <a href="/goods/{no}">)
    productCard: ['a[href^="/goods/"]', '[class*="goodsList"] li', '[class*="ProductCard"]'],
    productName: ['span:has(+ p)', '[class*="goodsName"]', '[class*="ProductName"]'],
    productPrice: ['.sales-price .price-number', '.price-number', '[class*="discountPrice"]'],
    productLink: ['a[href^="/goods/"]', 'a[href*="/goods/"]', 'a'],
    soldOutBadge: ['[class*="soldout"]', '[class*="SoldOut"]', '[class*="stockout"]'],
    // 컬리는 검색 카드에서 바로 담기가 가능하다 (상세 경유 불필요)
    cardCartBtn: ['.button-wrapper button', 'button[aria-label*="장바구니"]', 'button[class*="cart"]'],
    // 상품 상세 (/goods/{no})
    detailQtyInput: ['input[class*="quantity"]', 'input[class*="count"]', 'input[type="number"]'],
    detailQtyPlus: ['button[class*="plus"]', 'button[aria-label*="증가"]', 'button[aria-label*="추가"]'],
    detailCartBtn: [
      'button[class*="addCart"]',
      'button[class*="cartButton"]',
      'button[class*="CartButton"]',
      'button[type="submit"][class*="cart"]',
    ],
    layerClose: ['button[class*="close"]', '[class*="modal"] button[class*="confirm"]'],
    // 마이컬리 쿠폰함
    couponRow: ['[class*="couponList"] li', '[class*="CouponItem"]'],
    couponName: ['[class*="couponName"]', '[class*="title"]'],
    // 장바구니 (/cart)
    cartLine: ['[class*="cartItem"]', '[class*="CartItem"]', '[class*="cartList"] li'],
    cartLineName: ['[class*="goodsName"]', '[class*="ProductName"]', '[class*="name"]'],
  };

  const isDetailPage = () => /^\/goods\//.test(location.pathname);
  const isCartPage = () => location.pathname.startsWith('/cart');

  window.__registerMartAdapter({
    martId: 'kurly',
    selectors: SELECTORS, // DIAGNOSE 메시지가 실페이지에서 후보별 매칭 수를 보고하는 데 사용

    async scrapeOffers() {
      const cards = qa(document, SELECTORS.productCard);
      if (cards.length === 0) {
        console.warn('[장보기 에이전트] kurly: 상품 카드 셀렉터 미매칭 — 수집 0건 (SELECTORS.productCard 확인 필요)');
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
      // 마이컬리 쿠폰함에서만 잡힌다. 다른 페이지에선 0건이 정상.
      const rows = qa(document, SELECTORS.couponRow);
      if (rows.length === 0) return [];
      return rows.map((row, i) => ({
        id: `kurly-scraped-${i}`,
        name: q(row, SELECTORS.couponName)?.textContent?.trim() ?? '이름 미상 쿠폰',
        type: 'fixed',
        value: 0,
        minOrder: 0,
      }));
    },

    async scrapeSlots() {
      // 샛별배송 가능 여부는 배송지에 종속적이라 아직 파싱하지 않는다.
      // 추정 슬롯을 내보내면 "언제 오는지"를 틀리게 알려주게 되므로 빈 배열을 반환한다.
      return [];
    },

    async addItem(item) {
      // 상품 상세 페이지: 수량을 맞춘 뒤 담기
      if (isDetailPage()) {
        const qty = q(document, SELECTORS.detailQtyInput);
        if (qty) {
          setInputValue(qty, item.quantity);
        } else {
          // 컬리 상세는 수량이 +/- 버튼으로만 조작되는 경우가 있다
          const plus = q(document, SELECTORS.detailQtyPlus);
          if (plus) {
            for (let i = 1; i < item.quantity; i++) {
              plus.click();
              await sleep(250);
            }
          }
        }
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
      // 퀵담기가 없으면 상세 페이지로 이동해 재시도 (컬리의 기본 경로)
      const link = q(match.card, SELECTORS.productLink);
      const href = link?.href ?? (match.card.tagName === 'A' ? match.card.href : null);
      if (href) return { ok: false, navigate: href };
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
