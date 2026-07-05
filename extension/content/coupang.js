// 쿠팡(www.coupang.com) + 장바구니(cart.coupang.com) 어댑터.
//
// 쿠팡 검색 카드에는 담기 버튼이 없어 상품 상세 페이지를 경유한다:
// 검색 → 최적 카드의 링크 반환(navigate) → 상세에서 수량 설정 + 담기.
// 실사이트 최종 확인 필요 — 카드가 하나도 없으면 mock 폴백.

(() => {
  const { q, qa, parsePrice, pickBestCard, setInputValue, sleep, waitFor } = window.__ga;

  const SELECTORS = {
    productCard: ['li.search-product', 'ul#product-list li[class*="ProductUnit"]', 'li[class*="product"]'],
    productName: ['.name', 'div[class*="productName"]', '[class*="Name"]'],
    productPrice: ['.price-value', 'strong[class*="priceValue"]', '[class*="Price"] strong'],
    productLink: ['a.search-product-link', 'a[href*="/vp/products/"]', 'a'],
    soldOutBadge: ['.out-of-stock', '[class*="soldout"]', '[class*="OutOfStock"]'],
    rocketFreshBadge: ['img[alt*="로켓프레시"]', '[class*="rocket-fresh"]'],
    // 상품 상세 페이지 (/vp/products/...)
    detailQtyInput: ['input.prod-quantity__input', 'input[class*="quantity"]'],
    detailCartBtn: ['button.prod-cart-btn', 'button[class*="cart-btn"]', 'button[class*="addCart"]'],
    layerClose: ['.prod-order-alert button', 'button[class*="close"]'],
    couponRow: ['.my-coupon-list li', '[class*="couponItem"]'],
    couponName: ['.coupon-title', '[class*="couponName"]'],
    // cart.coupang.com 장바구니 행
    cartLine: ['.cart-deal-item', '[class*="cartItem"]', 'div[data-item-id]'],
    cartLineName: ['.product-name', 'a[class*="productName"]', '[class*="name"]'],
  };

  const MOCK_FALLBACK = {
    offers: [
      { siteName: '델몬트 바나나 1kg 내외', price: 3780, available: true },
      { siteName: '그릭데이 그릭요거트 플레인 4입', price: 5290, available: true },
      { siteName: '곰곰 무항생제 신선한 대란 30구', price: 8790, available: true },
    ],
    coupons: [
      { id: 'coupang-2000', name: '로켓프레시 2,000원 할인', type: 'fixed', value: 2000, minOrder: 25000 },
    ],
    slots: [{ date: '2026-07-05', timeRange: '새벽배송 (07:00 전)', available: true }],
  };

  const isDetailPage = () => location.pathname.includes('/vp/products/');
  const isCartPage = () => location.hostname === 'cart.coupang.com';

  window.__registerMartAdapter({
    martId: 'coupang',

    async scrapeOffers() {
      const cards = qa(document, SELECTORS.productCard);
      if (cards.length === 0) {
        console.warn('[장보기 에이전트] coupang: 상품 카드 셀렉터 미매칭 → mock 폴백');
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
        id: `coupang-scraped-${i}`,
        name: q(row, SELECTORS.couponName)?.textContent?.trim() ?? '이름 미상 쿠폰',
        type: 'fixed',
        value: 0,
        minOrder: 0,
      }));
    },

    async scrapeSlots() {
      // 로켓프레시는 시간대 선택이 아닌 새벽/당일 고정 — mock 유지
      return MOCK_FALLBACK.slots;
    },

    async addItem(item) {
      // 상세 페이지: 수량 설정 후 담기
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

      // 검색 페이지: 카드에 담기 버튼이 없으므로 상세로 이동 요청
      const cards = await waitFor(() => {
        const found = qa(document, SELECTORS.productCard);
        return found.length > 0 ? found : null;
      });
      if (!cards) {
        console.warn(`[장보기 에이전트] coupang: 검색 카드 미발견 → mock 담기: ${item.name} x${item.quantity}`);
        return { ok: true, mocked: true };
      }

      // 로켓프레시 상품 우선, 없으면 전체에서 매칭
      const freshCards = cards.filter((c) => q(c, SELECTORS.rocketFreshBadge));
      const pool = freshCards.length > 0 ? freshCards : cards;
      const match = pickBestCard(pool, (c) => q(c, SELECTORS.productName)?.textContent, item.name);
      if (!match) return { ok: false, reason: `검색 결과에 '${item.name}' 유사 상품 없음` };
      if (q(match.card, SELECTORS.soldOutBadge)) return { ok: false, reason: '품절' };

      const link = q(match.card, SELECTORS.productLink);
      if (link?.href) return { ok: false, navigate: link.href };
      return { ok: false, reason: '상세 링크 미발견' };
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
