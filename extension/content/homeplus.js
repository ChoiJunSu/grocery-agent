// 홈플러스(front.homeplus.co.kr) 어댑터.
//
// TODO(실사이트 연동): SELECTORS를 실제 홈플러스 DOM 기준으로 교체.
// 셀렉터 미매칭 시 mock 폴백으로 전체 사이클 테스트 가능.

(() => {
  const SELECTORS = {
    productCard: '.unitItem',
    productName: '.css-name, .unitItem__name',
    productPrice: '.priceValue',
    soldOutBadge: '.soldout',
    couponRow: '.couponList li',
    couponName: '.couponName',
    addToCartBtn: '.btnCart',
  };

  const MOCK_FALLBACK = {
    offers: [
      { productId: 'milk-1l', price: 2890, available: true },
      { productId: 'pork-500g', price: 11990, available: true },
      { productId: 'tissue-30', price: 14900, available: true },
    ],
    coupons: [
      { id: 'homeplus-3000', name: '홈플러스 3,000원 할인', type: 'fixed', value: 3000, minOrder: 30000 },
    ],
    slots: [{ date: '2026-07-05', timeRange: '10:00~13:00', available: true }],
  };

  const parsePrice = (text) => Number(text.replace(/[^0-9]/g, ''));

  window.__registerMartAdapter({
    martId: 'homeplus',

    async scrapeOffers() {
      const cards = document.querySelectorAll(SELECTORS.productCard);
      if (cards.length === 0) {
        console.log('[장보기 에이전트] homeplus: 상품 DOM 미발견 → mock 폴백');
        return MOCK_FALLBACK.offers;
      }
      return [...cards]
        .map((card) => {
          const name = card.querySelector(SELECTORS.productName)?.textContent?.trim();
          const priceText = card.querySelector(SELECTORS.productPrice)?.textContent;
          if (!name || !priceText) return null;
          return {
            productId: name, // TODO(실사이트 연동): productId 매핑
            price: parsePrice(priceText),
            available: !card.querySelector(SELECTORS.soldOutBadge),
          };
        })
        .filter(Boolean);
    },

    async scrapeCoupons() {
      const rows = document.querySelectorAll(SELECTORS.couponRow);
      if (rows.length === 0) return MOCK_FALLBACK.coupons;
      return [...rows].map((row, i) => ({
        id: `homeplus-scraped-${i}`,
        name: row.querySelector(SELECTORS.couponName)?.textContent?.trim() ?? '이름 미상 쿠폰',
        type: 'fixed',
        value: 0,
        minOrder: 0,
      }));
    },

    async scrapeSlots() {
      // TODO(실사이트 연동): 배송 예약 슬롯 DOM 파싱
      return MOCK_FALLBACK.slots;
    },

    async addToCart(items) {
      const added = [];
      const failed = [];
      for (const item of items) {
        const btn = document.querySelector(SELECTORS.addToCartBtn);
        if (btn) {
          btn.click();
          added.push(item.productId);
        } else {
          console.log(`[장보기 에이전트] homeplus: ${item.name} x${item.quantity} 담기 (mock)`);
          added.push(item.productId);
        }
      }
      return { added, failed };
    },
  });
})();
