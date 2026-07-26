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
  kurly: {
    urlPatterns: ['*://www.kurly.com/*', '*://m.kurly.com/*'],
    searchUrl: (query) => `https://www.kurly.com/search?sword=${encodeURIComponent(query)}`,
    cartUrl: 'https://www.kurly.com/cart',
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
  const headers = { 'X-User-Token': token, ...(options.headers ?? {}) };
  // 바디 없는 POST에 Content-Type: application/json을 붙이면 Fastify가 400으로 거절한다
  // (FST_ERR_CTP_EMPTY_JSON_BODY)
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${SERVER}${path}`, { ...options, headers });
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

  // 상품을 하나도 못 읽었으면 서버에 빈 스냅샷을 올리지 않는다. 올리면 그 마트가
  // "수집됨(0건)"이 되어 비교에서 조용히 빠진다.
  if (!scraped.offers || scraped.offers.length === 0) {
    return {
      martId,
      ok: false,
      error: '수집된 상품 0건 — 검색/카테고리 페이지를 연 탭에서 실행하세요 (셀렉터 미매칭이면 콘솔 경고 확인)',
    };
  }

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
async function verifyCart(tabId, martId, items) {
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

  for (const item of action.items) {
    try {
      const res = await addSingleItem(tab.id, action.martId, item);
      if (res.ok) {
        added.push(item.name);
      } else {
        failed.push(`${item.name}(${res.reason ?? res.error ?? '원인 미상'})`);
      }
    } catch (e) {
      failed.push(`${item.name}(${String(e)})`);
    }
  }

  // 한 건이라도 담기에 실패했으면 실패로 보고한다. 부분 성공을 성공으로 올리면
  // 웹 UI가 "담김"으로 표시해 사용자가 결제 직전에야 누락을 발견하게 된다.
  const { verified, note } = await verifyCart(tab.id, action.martId, action.items);
  const status = failed.length === 0 ? 'done' : 'failed';
  const detail = [`담김 ${added.length}/${action.items.length}건`, failed.length ? `실패: ${failed.join(', ')}` : null, note]
    .filter(Boolean)
    .join(' | ');
  return { status, verified, detail };
}

let processing = false;

// MV3 서비스 워커는 확장 API 호출이 30초간 없으면 크롬이 종료시킨다. 담기 작업은
// 페이지 로딩 대기(waitTabComplete 최대 20초)와 sleep으로 이뤄져 있는데 setTimeout은
// 수명을 연장해주지 않으므로, 작업이 도는 동안 주기적으로 확장 API를 호출해 살려둔다.
// 이게 없으면 워커가 담기 중간에 죽고 작업은 서버에 claimed인 채로 유실된다.
let keepAliveTimer = null;

function startKeepAlive() {
  if (keepAliveTimer !== null) return;
  keepAliveTimer = setInterval(() => {
    chrome.runtime.getPlatformInfo().catch(() => {});
  }, 20000);
}

function stopKeepAlive() {
  if (keepAliveTimer === null) return;
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

async function processPendingActions() {
  if (processing) return; // 알람 중복 진입 방지
  processing = true;
  startKeepAlive();
  try {
    let claimed;
    try {
      claimed = await api('/api/actions/claim', { method: 'POST' });
    } catch (e) {
      // 서버 미기동/토큰 미설정이면 정상 상황이지만, 그 외 실패는 작업이 pending에
      // 영영 멈춘 것처럼 보이므로 워커 콘솔에는 남긴다
      console.warn('[장보기] 작업 폴링 실패:', e.message);
      return;
    }

    for (const action of claimed.actions) {
      let result;
      try {
        console.log(`[장보기] ${action.martId} 담기 시작 — ${action.items.length}품목`);
        result = await executeAction(action);
      } catch (e) {
        result = { status: 'failed', verified: false, detail: String(e) };
      }
      console.log(`[장보기] ${action.martId} 결과:`, result.status, result.detail ?? '');
      await api('/api/actions/result', {
        method: 'POST',
        body: JSON.stringify({ actionId: action.id, ...result }),
      }).catch((e) => console.warn('[장보기] 결과 보고 실패:', e.message));
    }
  } finally {
    stopKeepAlive();
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
  if (message.type === 'DIAGNOSE_ACTIVE_TAB') {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(async ([tab]) => {
        if (!tab) return sendResponse({ ok: false, error: '활성 탭 없음' });
        const res = await sendToTab(tab.id, { type: 'DIAGNOSE' });
        if (!res.ok) {
          sendResponse({
            ok: false,
            error: `${res.error} — 지원 마트(이마트/홈플러스/쿠팡/컬리) 페이지인지 확인하세요`,
          });
          return;
        }
        sendResponse(res);
      })
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});
