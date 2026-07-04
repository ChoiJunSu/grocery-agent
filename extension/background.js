// 서비스 워커: 서버와의 통신 허브.
//  - 팝업의 "동기화" 요청 → 열린 마트 탭들에 SCRAPE_ALL → /api/ingest 전송
//  - 15초 주기 알람 → /api/actions/claim 폴링 → 마트 탭에 ADD_TO_CART → 결과 보고

const SERVER = 'http://localhost:3001';

const MART_URL_PATTERNS = {
  emart: '*://emart.ssg.com/*',
  homeplus: '*://front.homeplus.co.kr/*',
  coupang: '*://www.coupang.com/*',
};

// ---------- 유틸 ----------

async function api(path, options = {}) {
  const res = await fetch(`${SERVER}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

async function findMartTab(martId) {
  const tabs = await chrome.tabs.query({ url: MART_URL_PATTERNS[martId] });
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

/** 탭이 없으면 새로 열고 content script가 로드될 때까지 대기 */
async function ensureMartTab(martId, url) {
  const existing = await findMartTab(martId);
  if (existing) return existing;
  const tab = await chrome.tabs.create({ url, active: false });
  await new Promise((resolve) => {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000); // 로드 타임아웃
  });
  return tab;
}

// ---------- 가격/쿠폰 동기화 ----------

async function syncMart(martId) {
  const tab = await findMartTab(martId);
  if (!tab) return { martId, ok: false, error: '열린 탭 없음 (마트에 로그인 후 탭을 열어두세요)' };

  const scraped = await sendToTab(tab.id, { type: 'SCRAPE_ALL' });
  if (!scraped.ok) return { martId, ok: false, error: scraped.error };

  await api('/api/ingest', {
    method: 'POST',
    body: JSON.stringify({
      martId,
      offers: scraped.offers,
      coupons: scraped.coupons,
      slots: scraped.slots,
    }),
  });
  return { martId, ok: true, offerCount: scraped.offers.length };
}

async function syncAllMarts() {
  const results = [];
  for (const martId of Object.keys(MART_URL_PATTERNS)) {
    try {
      results.push(await syncMart(martId));
    } catch (e) {
      results.push({ martId, ok: false, error: String(e) });
    }
  }
  return results;
}

// ---------- 장바구니 담기 작업 폴링 ----------

async function processPendingActions() {
  let claimed;
  try {
    claimed = await api('/api/actions/claim', { method: 'POST' });
  } catch {
    return; // 서버 미기동 시 조용히 스킵
  }

  for (const action of claimed.actions) {
    let status = 'failed';
    let detail = '';
    try {
      const tab = await ensureMartTab(action.martId, action.cartUrl);
      const result = await sendToTab(tab.id, { type: 'ADD_TO_CART', items: action.items });
      if (result.ok) {
        status = result.failed?.length ? 'failed' : 'done';
        detail = `담김 ${result.added?.length ?? 0}건, 실패 ${result.failed?.length ?? 0}건`;
      } else {
        detail = result.error;
      }
    } catch (e) {
      detail = String(e);
    }
    await api('/api/actions/result', {
      method: 'POST',
      body: JSON.stringify({ actionId: action.id, status, detail }),
    }).catch(() => {});
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
    api('/api/health')
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});
