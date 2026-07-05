// 서비스 워커: 서버와의 통신 허브 + 장바구니 담기 오케스트레이션.
//  - 팝업의 "동기화" 요청 → 열린 마트 탭들에 SCRAPE_ALL → /api/ingest 전송
//  - 15초 주기 알람 → /api/actions/claim 폴링 → 품목별로 검색 탭을 열어 담기
//    (검색 카드에 담기 버튼이 없으면 상세 페이지로 한 번 더 이동해 재시도)
//  - 담기 완료 후 장바구니 페이지를 열어 실제 반영 여부를 검증(verified)

const SERVER = 'http://localhost:3001';

const MART_CONFIG = {
  emart: {
    urlPatterns: ['*://emart.ssg.com/*', '*://pay.ssg.com/*'],
    searchUrl: (query) => `https://emart.ssg.com/search.ssg?target=all&query=${encodeURIComponent(query)}`,
    cartUrl: 'https://pay.ssg.com/cart/dmsShpp.ssg',
  },
  homeplus: {
    urlPatterns: ['*://front.homeplus.co.kr/*', '*://mfront.homeplus.co.kr/*'],
    searchUrl: (query) => `https://front.homeplus.co.kr/search?entry=direct&keyword=${encodeURIComponent(query)}`,
    cartUrl: 'https://front.homeplus.co.kr/cart',
  },
  coupang: {
    urlPatterns: ['*://www.coupang.com/*', '*://cart.coupang.com/*'],
    searchUrl: (query) => `https://www.coupang.com/np/search?component=&q=${encodeURIComponent(query)}`,
    cartUrl: 'https://cart.coupang.com/cartView.pang',
  },
};

// ---------- 서버 통신 ----------

async function getToken() {
  const { userToken } = await chrome.storage.sync.get('userToken');
  return userToken ?? null;
}

async function api(path, options = {}) {
  const token = await getToken();
  if (!token) throw new Error('사용자 토큰 미설정 — 팝업에서 웹 UI의 토큰을 붙여넣으세요');
  const res = await fetch(`${SERVER}${path}`, {
    headers: { 'Content-Type': 'application/json', 'X-User-Token': token },
    ...options,
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

// ---------- 탭 제어 ----------

async function findMartTab(martId) {
  const tabs = await chrome.tabs.query({ url: MART_CONFIG[martId].urlPatterns });
  return tabs[0] ?? null;
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response ?? { ok: false, error: 'no response' });
      }
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitTabComplete(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);
  });
}

/** content script가 응답할 때까지 PING 재시도 (SPA 초기 렌더링 대기 포함) */
async function waitContentReady(tabId, { retries = 10, delay = 800 } = {}) {
  for (let i = 0; i < retries; i++) {
    const res = await sendToTab(tabId, { type: 'PING' });
    if (res.ok && res.ready) return true;
    await sleep(delay);
  }
  return false;
}

/** 탭을 URL로 이동시키고 content script가 준비될 때까지 대기 */
async function navigateAndWait(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await waitTabComplete(tabId);
  await sleep(1500); // SPA 렌더링 여유
  return waitContentReady(tabId);
}

// ---------- 가격/쿠폰 동기화 ----------

async function syncMart(martId) {
  const tab = await findMartTab(martId);
  if (!tab) return { martId, ok: false, error: '열린 탭 없음 (마트에 로그인 후 탭을 열어두세요)' };

  const scraped = await sendToTab(tab.id, { type: 'SCRAPE_ALL' });
  if (!scraped.ok) return { martId, ok: false, error: scraped.error };

  const result = await api('/api/ingest', {
    method: 'POST',
    body: JSON.stringify({
      martId,
      offers: scraped.offers,
      coupons: scraped.coupons,
      slots: scraped.slots,
    }),
  });
  return {
    martId,
    ok: true,
    matchedCount: result.matchedCount,
    unmatchedCount: result.unmatchedCount,
  };
}

async function syncAllMarts() {
  const results = [];
  for (const martId of Object.keys(MART_CONFIG)) {
    try {
      results.push(await syncMart(martId));
    } catch (e) {
      results.push({ martId, ok: false, error: String(e) });
    }
  }
  return results;
}

// ---------- 장바구니 담기 오케스트레이션 ----------

/** 품목 1건 담기: 검색 페이지에서 시도, navigate 응답이 오면 상세 페이지로 한 번 이동해 재시도 */
async function addSingleItem(tabId, martId, item) {
  const config = MART_CONFIG[martId];
  const ready = await navigateAndWait(tabId, config.searchUrl(item.name));
  if (!ready) return { ok: false, reason: 'content script 미응답 (로그인/봇차단 페이지 여부 확인)' };

  let res = await sendToTab(tabId, { type: 'ADD_ITEM', item });
  if (res.navigate) {
    const detailReady = await navigateAndWait(tabId, res.navigate);
    if (!detailReady) return { ok: false, reason: '상세 페이지 로드 실패' };
    res = await sendToTab(tabId, { type: 'ADD_ITEM', item });
  }
  return res;
}

/** 담기 완료 후 장바구니 페이지에서 품목들이 실제로 들어갔는지 확인 */
async function verifyCart(tabId, martId, items, anyMocked) {
  if (anyMocked) return { verified: false, note: 'mock 담기 포함 — 실DOM 검증 생략' };
  const config = MART_CONFIG[martId];
  const ready = await navigateAndWait(tabId, config.cartUrl);
  if (!ready) return { verified: false, note: '장바구니 페이지 미응답' };

  const res = await sendToTab(tabId, { type: 'SCRAPE_CART' });
  if (!res.ok || !res.cart) return { verified: false, note: '장바구니 DOM 검증 불가 — 셀렉터 확인 필요' };

  const similarity = simFactory();
  const missing = items.filter(
    (item) => !res.cart.names.some((name) => similarity(name, item.name) >= 0.55),
  );
  if (missing.length === 0) return { verified: true, note: `장바구니 검증 통과 (${res.cart.names.length}개 라인)` };
  return { verified: false, note: `장바구니에서 미발견: ${missing.map((m) => m.name).join(', ')}` };
}

/** content/common.js의 nameSimilarity와 동일 로직 (서비스 워커에서 재사용) */
function simFactory() {
  const normalize = (s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/[^0-9a-z가-힣]/g, '');
  const grams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  return (a, b) => {
    const na = normalize(a);
    const nb = normalize(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const ba = grams(na);
    const bb = grams(nb);
    if (ba.size === 0 || bb.size === 0) return 0;
    let inter = 0;
    for (const g of ba) if (bb.has(g)) inter++;
    return Math.max((2 * inter) / (ba.size + bb.size), (inter / Math.min(ba.size, bb.size)) * 0.9);
  };
}

async function executeAction(action) {
  const config = MART_CONFIG[action.martId];
  if (!config) return { status: 'failed', verified: false, detail: `알 수 없는 마트: ${action.martId}` };

  // 작업용 탭: 기존 마트 탭을 재사용하되 없으면 백그라운드로 새로 연다
  let tab = await findMartTab(action.martId);
  if (!tab) tab = await chrome.tabs.create({ url: config.searchUrl(''), active: false });

  const added = [];
  const failed = [];
  let anyMocked = false;

  for (const item of action.items) {
    try {
      const res = await addSingleItem(tab.id, action.martId, item);
      if (res.ok) {
        added.push(item.name);
        if (res.mocked) anyMocked = true;
      } else {
        failed.push(`${item.name}(${res.reason ?? res.error ?? '원인 미상'})`);
      }
    } catch (e) {
      failed.push(`${item.name}(${String(e)})`);
    }
  }

  const { verified, note } = await verifyCart(tab.id, action.martId, action.items, anyMocked);
  const status = failed.length === 0 ? 'done' : 'failed';
  const detail = [`담김 ${added.length}/${action.items.length}건`, failed.length ? `실패: ${failed.join(', ')}` : null, note]
    .filter(Boolean)
    .join(' | ');
  return { status, verified, detail };
}

let processing = false;

async function processPendingActions() {
  if (processing) return; // 알람 중복 진입 방지
  processing = true;
  try {
    let claimed;
    try {
      claimed = await api('/api/actions/claim', { method: 'POST' });
    } catch {
      return; // 서버 미기동/토큰 미설정 시 조용히 스킵
    }

    for (const action of claimed.actions) {
      let result;
      try {
        result = await executeAction(action);
      } catch (e) {
        result = { status: 'failed', verified: false, detail: String(e) };
      }
      await api('/api/actions/result', {
        method: 'POST',
        body: JSON.stringify({ actionId: action.id, ...result }),
      }).catch(() => {});
    }
  } finally {
    processing = false;
  }
}

chrome.alarms.create('poll-actions', { periodInMinutes: 0.25 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll-actions') processPendingActions();
});

// ---------- 팝업 메시지 ----------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SYNC_ALL') {
    syncAllMarts().then((results) => sendResponse({ ok: true, results }));
    return true;
  }
  if (message.type === 'CHECK_SERVER') {
    fetch(`${SERVER}/api/health`)
      .then((r) => sendResponse({ ok: r.ok }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});
