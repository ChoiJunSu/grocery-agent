// 홈플러스(front.homeplus.co.kr) 어댑터.
//
// 홈플러스 온라인몰은 CSS-module 해시 클래스를 쓰는 React SPA라
// [class*=...] 부분 일치 셀렉터를 우선 사용한다. 실사이트 최종 확인 필요 —
// 상품 카드가 하나도 없으면 mock 폴백.

(() => {
  const { q, qa, parsePrice, pickBestCard, setInputValue, sleep, waitFor } = window.__ga;

  const SELECTORS = {
    productCard: ['[class*="unitItem"]', '[class*="productItem"]', '[class*="prodCard"]', 'li[class*="item"]'],
    productName: ['[class*="prodName"]', '[class*="itemName"]', '[class*="name"]'],
    productPrice: ['[class*="priceValue"]', '[class*="salePrice"] strong', '[class*="price"] strong'],
    productLink: ['a[href*="/item"]', 'a[href*="itemNo"]', 'a'],
    soldOutBadge: ['[class*="soldout"]', '[class*="soldOut"]'],
    cardCartBtn: ['button[class*="cart"]', 'button[aria-label*="장바구니"]'],
    detailQtyInput: ['input[class*="quantity"]', 'input[class*="qty"]', 'input[type="number"]'],
    detailCartBtn: ['button[class*="cartBtn"]', 'button[class*="addCart"]'],
    layerClose: ['button[class*="close"]', '[class*="modal"] button[class*="cancel"]'],
    couponRow: ['[class*="couponItem"]', '[class*="couponList"] li'],
    couponName: ['[class*="couponName"]', '[class*="title"]'],
    cartLine: ['[class*="cartItem"]', '[class*="cartProduct"]', '[class*="cartList"] li'],
    cartLineName: ['[class*="prodName"]', '[class*="itemName"]', '[class*="name"]'],
  };

  const MOCK_FALLBACK = {
    offers: [
      { siteName: '서울우유 1000ml', price: 2890, available: true },
      { siteName: '한돈 삼겹살 500g', price: 11990, available: true },
      { siteName: '깨끗한나라 3겹 화장지 30롤', price: 14900, available: true },
    ],
    coupons: [
      { id: 'homeplus-3000', name: '홈플러스 3,000원 할인', type: 'fixed', value: 3000, minOrder: 30000 },
    ],
    slots: [{ date: '2026-07-05', timeRange: '10:00~13:00', available: true }],
  };

  const isDetailPage = () => /\/item|itemNo=/.test(location.href);
  const isCartPage = () => location.pathname.startsWith('/cart');

  window.__registerMartAdapter({
    martId: 'homeplus',

    async scrapeOffers() {
      const cards = qa(document, SELECTORS.productCard);
      if (cards.length === 0) {
        console.warn('[장보기 에이전트] homeplus: 상품 카드 셀렉터 미매칭 → mock 폴백');
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
      return rows.map((row, i) => ({
        id: `homeplus-scraped-${i}`,
        name: q(row, SELECTORS.couponName)?.textContent?.trim() ?? '이름 미상 쿠폰',
        type: 'fixed',
        value: 0,
        minOrder: 0,
      }));
    },

    async scrapeSlots() {
      // 배송 슬롯은 점포/배송지 설정에 종속 — 실DOM 확인 전까지 mock
      return MOCK_FALLBACK.slots;
    },

    async addItem(item) {
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

      const cards = await waitFor(() => {
        const found = qa(document, SELECTORS.productCard);
        return found.length > 0 ? found : null;
      });
      if (!cards) {
        console.warn(`[장보기 에이전트] homeplus: 검색 카드 미발견 → mock 담기: ${item.name} x${item.quantity}`);
        return { ok: true, mocked: true };
      }

      const match = pickBestCard(cards, (c) => q(c, SELECTORS.productName)?.textContent, item.name);
      if (!match) return { ok: false, reason: `검색 결과에 '${item.name}' 유사 상품 없음` };
      if (q(match.card, SELECTORS.soldOutBadge)) return { ok: false, reason: '품절' };

      const cartBtn = q(match.card, SELECTORS.cardCartBtn);
      if (cartBtn) {
        for (let i = 0; i < item.quantity; i++) {
          cartBtn.click();
          await sleep(900);
          q(document, SELECTORS.layerClose)?.click();
        }
        return { ok: true };
      }
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
