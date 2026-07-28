// Playwright 브라우저 수명 관리 + 페이지 1건 스캔.
// 공공 사이트라 동시 실행과 요청 간격을 보수적으로 잡는다.

import { chromium } from 'playwright';
import { CONFIG, TIME_RANGE_RE, STATE_RULES } from '../config.js';
import { log, sleep } from '../util.js';
import { scanFn, scanArg } from './pageScan.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function openBrowser() {
  // 기본은 playwright가 설치한 chromium. 이미 있는 크롬을 쓰려면 TENNIS_CHROME_PATH로 지정한다.
  const executablePath = process.env.TENNIS_CHROME_PATH || undefined;
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({
    userAgent: UA,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1440, height: 1000 },
  });
  context.setDefaultTimeout(CONFIG.navTimeoutMs);
  return { browser, context };
}

/**
 * URL 하나를 열고 스캔한다. 실패하면 던지지 않고 error를 담아 돌려준다 —
 * 코트 한 곳이 죽었다고 전체 수집이 멈추면 안 된다.
 */
export async function scanUrl(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.navTimeoutMs });
    // 달력이 스크립트로 그려지는 경우가 있어 잠깐 기다린다.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const scan = await page.evaluate(scanFn, scanArg(TIME_RANGE_RE, STATE_RULES));
    return { ok: true, scan };
  } catch (err) {
    log.warn(`스캔 실패 ${url}: ${err.message}`);
    return { ok: false, error: err.message, url };
  } finally {
    await page.close().catch(() => {});
    await sleep(CONFIG.politeDelayMs);
  }
}
