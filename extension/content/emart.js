// 이마트 쓱배송(emart.ssg.com) 어댑터.
//
// TODO(실사이트 연동): 아래 SELECTORS는 실제 쓱배송 DOM 확인 후 채워야 한다.
// 지금은 셀렉터가 매칭되지 않으면 mock 데이터로 폴백해서 전체 사이클을 테스트할 수 있게 한다.

(() => {
  const SELECTORS = {
    // 상품 목록 카드 (검색 결과/카테고리 페이지)
    productCard: '[data-unittype="item"]',
    productName: '.mnemitem_goods_tit',
    productPrice: '.new_price .ssg_price',
    soldOutBadge: '.mnemitem_soldout',
    // 마이페이지 쿠폰함
    couponRow: '.cunit_coupon_item',
    couponName: '.coupon_tit',
    // 장바구니 담기 버튼 (상품 카드 내)
    addToCartBtn: '.cmitem_btn_cart',
  };

  const MOCK_FALLBACK = {
    offers: [
      { productId: 'milk-1l', price: 2980, available: true },
      { productId: 'eggs-30', price: 8980, available: true },
      { productId: 'rice-10kg', price: 32900, available: true },
    ],
    coupons: [
      {
        id: 'emart-10pct',
        name: '쓱배송 10% (최대 5천원)',
        type: 'percent',
        value: 10,
        minOrder: 50000,
        maxDiscount: 5000,
      },
    ],
    slots: [{ date: '2026-07-05', timeRange: '14:00~17:00', available: true }],
  };

  const parsePrice = (text) => Number(text.replace(/[^0-9]/g, ''));

  window.__registerMartAdapter({
    martId: 'emart',

    async scrapeOffers() {
      const cards = document.querySelectorAll(SELECTORS.productCard);
      if (cards.length === 0) {
        console.log('[장보기 에이전트] emart: 상품 DOM 미발견 → mock 폴백');
        return MOCK_FALLBACK.offers;
      }
      return [...cards]
        .map((card) => {
          const name = card.querySelector(SELECTORS.productName)?.textContent?.trim();
          const priceText = card.querySelector(SELECTORS.productPrice)?.textContent;
          if (!name || !priceText) return null;
          return {
            // TODO(실사이트 연동): 사이트 상품명 → 내부 productId 매핑 테이블 필요
            productId: name,
            price: parsePrice(priceText),
            available: !card.querySelector(SELECTORS.soldOutBadge),
          };
        })
        .filter(Boolean);
    },

    async scrapeCoupons() {
      const rows = document.querySelectorAll(SELECTORS.couponRow);
      if (rows.length === 0) return MOCK_FALLBACK.coupons;
      // TODO(실사이트 연동): 쿠폰함 DOM에서 할인율/최소주문금액 파싱
      return [...rows].map((row, i) => ({
        id: `emart-scraped-${i}`,
        name: row.querySelector(SELECTORS.couponName)?.textContent?.trim() ?? '이름 미상 쿠폰',
        type: 'fixed',
        value: 0,
        minOrder: 0,
      }));
    },

    async scrapeSlots() {
      // TODO(실사이트 연동): 쓱배송 예약 캘린더 DOM 파싱
      return MOCK_FALLBACK.slots;
    },

    async addToCart(items) {
      const added = [];
      const failed = [];
      for (const item of items) {
        // TODO(실사이트 연동):
        //  1. 상품 검색 페이지로 이동 또는 상품 카드 탐색
        //  2. 수량 input 설정 후 SELECTORS.addToCartBtn 클릭
        //  3. 담기 완료 토스트/모달 확인
        const btn = document.querySelector(SELECTORS.addToCartBtn);
        if (btn) {
          btn.click();
          added.push(item.productId);
        } else {
          console.log(`[장보기 에이전트] emart: ${item.name} x${item.quantity} 담기 (mock)`);
          added.push(item.productId); // mock 모드: 성공 처리
        }
      }
      return { added, failed };
    },
  });
})();
