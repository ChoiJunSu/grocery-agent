// 쿠팡 로켓프레시(www.coupang.com) 어댑터.
//
// TODO(실사이트 연동): SELECTORS를 실제 쿠팡 DOM 기준으로 교체.
// 셀렉터 미매칭 시 mock 폴백으로 전체 사이클 테스트 가능.

(() => {
  const SELECTORS = {
    productCard: 'li.search-product',
    productName: '.name',
    productPrice: '.price-value',
    soldOutBadge: '.out-of-stock',
    couponRow: '.my-coupon-list li',
    couponName: '.coupon-title',
    addToCartBtn: '.prod-cart-btn',
  };

  const MOCK_FALLBACK = {
    offers: [
      { productId: 'banana-1kg', price: 3780, available: true },
      { productId: 'yogurt-4', price: 5290, available: true },
      { productId: 'eggs-30', price: 8790, available: true },
    ],
    coupons: [
      { id: 'coupang-2000', name: '로켓프레시 2,000원 할인', type: 'fixed', value: 2000, minOrder: 25000 },
    ],
    slots: [{ date: '2026-07-05', timeRange: '새벽배송 (07:00 전)', available: true }],
  };

  const parsePrice = (text) => Number(text.replace(/[^0-9]/g, ''));

  window.__registerMartAdapter({
    martId: 'coupang',

    async scrapeOffers() {
      const cards = document.querySelectorAll(SELECTORS.productCard);
      if (cards.length === 0) {
        console.log('[장보기 에이전트] coupang: 상품 DOM 미발견 → mock 폴백');
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
        id: `coupang-scraped-${i}`,
        name: row.querySelector(SELECTORS.couponName)?.textContent?.trim() ?? '이름 미상 쿠폰',
        type: 'fixed',
        value: 0,
        minOrder: 0,
      }));
    },

    async scrapeSlots() {
      // TODO(실사이트 연동): 로켓프레시 배송 시간 안내 파싱
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
          console.log(`[장보기 에이전트] coupang: ${item.name} x${item.quantity} 담기 (mock)`);
          added.push(item.productId);
        }
      }
      return { added, failed };
    },
  });
})();
