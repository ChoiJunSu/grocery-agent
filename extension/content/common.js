// 모든 마트 content script가 공유하는 어댑터 등록/메시지 라우팅 레이어.
// 각 마트 스크립트는 registerMartAdapter()로 자기 어댑터를 등록하기만 하면 된다.
//
// 어댑터 인터페이스:
//   {
//     martId: string,
//     scrapeOffers(): Promise<Offer[]>,     // 현재 페이지에서 읽을 수 있는 상품 가격/재고
//     scrapeCoupons(): Promise<Coupon[]>,   // 로그인 사용자의 보유 쿠폰
//     scrapeSlots(): Promise<DeliverySlot[]>,
//     addToCart(items): Promise<{added: string[], failed: {productId, reason}[]}>
//   }
//
// 보안 원칙: 비밀번호/카드번호 등 자격증명은 절대 읽지 않는다.
// 이미 로그인된 세션의 DOM에 렌더링된 정보(가격, 쿠폰명, 재고)만 읽는다.

(() => {
  let adapter = null;

  window.__registerMartAdapter = (a) => {
    adapter = a;
    console.log(`[장보기 에이전트] 어댑터 등록: ${a.martId}`);
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!adapter) {
      sendResponse({ ok: false, error: 'adapter not ready' });
      return false;
    }

    const handle = async () => {
      switch (message.type) {
        case 'SCRAPE_ALL': {
          const [offers, coupons, slots] = await Promise.all([
            adapter.scrapeOffers(),
            adapter.scrapeCoupons(),
            adapter.scrapeSlots(),
          ]);
          return { ok: true, martId: adapter.martId, offers, coupons, slots };
        }
        case 'ADD_TO_CART': {
          const result = await adapter.addToCart(message.items);
          return { ok: true, martId: adapter.martId, ...result };
        }
        default:
          return { ok: false, error: `unknown message: ${message.type}` };
      }
    };

    handle()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async 응답
  });
})();
