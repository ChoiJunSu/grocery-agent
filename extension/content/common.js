// 모든 마트 content script가 공유하는 어댑터 등록/메시지 라우팅 + DOM/매칭 유틸.
// 각 마트 스크립트는 registerMartAdapter()로 자기 어댑터를 등록한다.
//
// 어댑터 인터페이스:
//   {
//     martId: string,
//     scrapeOffers(): Promise<{siteName, price, available}[]>,  // 페이지의 상품 카드
//     scrapeCoupons(): Promise<Coupon[]>,
//     scrapeSlots(): Promise<DeliverySlot[]>,
//     addItem(item): Promise<{ok, mocked?, reason?}>,  // 검색 결과 페이지에서 해당 상품 1건 담기
//     scrapeCart(): Promise<{names: string[]} | null>, // 장바구니 페이지의 상품명 목록 (검증용)
//   }
//
// 보안 원칙: 비밀번호/카드번호 등 자격증명은 절대 읽지 않는다.
// 이미 로그인된 세션의 DOM에 렌더링된 정보(가격, 쿠폰명, 재고)만 읽는다.

(() => {
  let adapter = null;

  // ---------- 공용 유틸 (window.__ga로 어댑터에 노출) ----------

  /** 후보 셀렉터 배열을 순서대로 시도해 첫 매칭 요소를 반환 */
  const q = (root, candidates) => {
    for (const sel of candidates) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  /** 후보 셀렉터 배열을 순서대로 시도해 처음으로 1개 이상 잡히는 NodeList 반환 */
  const qa = (root, candidates) => {
    for (const sel of candidates) {
      const els = root.querySelectorAll(sel);
      if (els.length > 0) return [...els];
    }
    return [];
  };

  const parsePrice = (text) => {
    const n = Number(String(text ?? '').replace(/[^0-9]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const normalizeName = (name) =>
    String(name ?? '')
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/[^0-9a-z가-힣]/g, '');

  /** packages/core matching.ts의 바이그램 Dice + 포함률과 동일한 로직 (경량 복제) */
  const nameSimilarity = (a, b) => {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const grams = (s) => {
      const set = new Set();
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
      return set;
    };
    const ba = grams(na);
    const bb = grams(nb);
    if (ba.size === 0 || bb.size === 0) return 0;
    let inter = 0;
    for (const g of ba) if (bb.has(g)) inter++;
    const dice = (2 * inter) / (ba.size + bb.size);
    const containment = inter / Math.min(ba.size, bb.size);
    return Math.max(dice, containment * 0.9);
  };

  const MATCH_THRESHOLD = 0.55;

  /** 카드 목록에서 대상 상품명과 가장 유사한 카드를 고른다 (임계값 미만이면 null) */
  const pickBestCard = (cards, getName, targetName) => {
    let best = null;
    let bestScore = 0;
    for (const card of cards) {
      const score = nameSimilarity(getName(card) ?? '', targetName);
      if (score > bestScore) {
        bestScore = score;
        best = card;
      }
    }
    return bestScore >= MATCH_THRESHOLD ? { card: best, score: bestScore } : null;
  };

  /** input에 값을 넣고 프레임워크(React/Vue)가 인식하도록 이벤트를 발생시킨다 */
  const setInputValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, String(value));
    else input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** SPA 렌더링 대기: 조건이 참이 될 때까지 폴링 */
  const waitFor = async (fn, { timeout = 8000, interval = 300 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = fn();
      if (result) return result;
      await sleep(interval);
    }
    return null;
  };

  window.__ga = { q, qa, parsePrice, normalizeName, nameSimilarity, pickBestCard, setInputValue, sleep, waitFor, MATCH_THRESHOLD };

  // ---------- 어댑터 등록 + 메시지 라우팅 ----------

  window.__registerMartAdapter = (a) => {
    adapter = a;
    console.log(`[장보기 에이전트] 어댑터 등록: ${a.martId} @ ${location.hostname}`);
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ ok: true, ready: adapter !== null });
      return false;
    }
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
        case 'ADD_ITEM': {
          const result = await adapter.addItem(message.item);
          return { martId: adapter.martId, ...result };
        }
        case 'SCRAPE_CART': {
          const cart = await adapter.scrapeCart();
          return { ok: true, martId: adapter.martId, cart };
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
