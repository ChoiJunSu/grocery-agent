// yeyak.seoul.go.kr 코트 상세 페이지에서 날짜별 예약 가능 여부를 긁는다.
//
// 오픈API가 코트 단위 상태(접수중/마감)까지만 주기 때문에 이 단계가 필요하다.
// 상세 페이지는 월 달력을 렌더링하고, 각 날짜 칸에 가능/마감이 표시된다.
//
// 검증 상태: 미검증. 이 저장소를 만든 환경에서 yeyak.seoul.go.kr 접근이 막혀 있어
// 실 DOM으로 확인하지 못했다. `npm run diagnose -- <코트URL>` 로 먼저 확인할 것.

import { CONFIG } from '../config.js';
import { log, pool } from '../util.js';
import { openBrowser, scanUrl } from './browser.js';
import { toSlots } from './pageScan.js';

/**
 * 접수 중인 코트만 상세 페이지를 연다.
 * 이미 마감된 코트까지 열면 수백 페이지가 되는데 얻을 게 없다.
 */
export function courtsWorthScanning(courts) {
  return courts.filter((c) => /접수|예약/.test(c.status) && !/마감|종료/.test(c.status));
}

export async function collectYeyakSlots(courts) {
  const targets = courtsWorthScanning(courts);
  if (targets.length === 0) {
    log.warn('접수 중인 yeyak 코트가 없다 — 슬롯 수집 건너뜀');
    return { slots: [], errors: [] };
  }

  log.info(`yeyak 상세 스캔 ${targets.length}건 (동시 ${CONFIG.concurrency})`);
  const { browser, context } = await openBrowser();
  const errors = [];

  try {
    const perCourt = await pool(targets, CONFIG.concurrency, async (court, i) => {
      const result = await scanUrl(context, court.url);
      if (!result.ok) {
        errors.push({ courtId: court.id, url: court.url, error: result.error });
        return [];
      }
      const slots = toSlots(court.id, result.scan);
      if (slots.length === 0) {
        errors.push({
          courtId: court.id,
          url: court.url,
          error: '달력에서 날짜를 못 읽음 (diagnose로 셀렉터/휴리스틱 확인 필요)',
        });
      }
      if ((i + 1) % 20 === 0) log.info(`  ...${i + 1}/${targets.length}`);
      return slots;
    });

    const slots = perCourt.flat().filter(Boolean);
    log.info(`yeyak 슬롯 ${slots.length}건 / 실패 ${errors.length}건`);
    return { slots, errors };
  } finally {
    await browser.close().catch(() => {});
  }
}
