// 올림픽테니스장(국민체육진흥공단) 온라인예약시스템.
// yeyak과 완전히 다른 시스템이라 오픈API가 없다 — 예약 화면을 직접 읽는다.
//
// 검증 상태: 미검증. courtLink 셀렉터가 안 맞으면 진입 페이지 한 장만 스캔하고 끝난다.
// 그 경우 errors에 남으니 `npm run diagnose -- https://www.ksponco.or.kr/online/tennis/index.do` 로 확인할 것.

import { KSPONCO, SELECTORS, CONFIG } from '../config.js';
import { log, pool } from '../util.js';
import { openBrowser, scanUrl } from './browser.js';
import { toSlots } from './pageScan.js';

/** 진입 페이지에서 코트별 예약 링크를 찾는다. 못 찾으면 빈 배열. */
async function findCourtLinks(context) {
  const page = await context.newPage();
  try {
    await page.goto(KSPONCO.entryUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.navTimeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    return await page.evaluate((candidates) => {
      for (const sel of candidates) {
        const links = [...document.querySelectorAll(sel)]
          .map((a) => ({ name: (a.textContent || '').replace(/\s+/g, ' ').trim(), href: a.href }))
          .filter((l) => l.href && /코트|court|테니스/i.test(l.name + l.href));
        if (links.length > 0) {
          // href 중복 제거
          const seen = new Set();
          return links.filter((l) => !seen.has(l.href) && seen.add(l.href));
        }
      }
      return [];
    }, SELECTORS.ksponco.courtLink);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function collectKsponco() {
  log.info('올림픽테니스장 수집 시작');
  const { browser, context } = await openBrowser();
  const errors = [];
  const courts = [];
  const slots = [];

  try {
    const links = await findCourtLinks(context);

    if (links.length === 0) {
      // 코트 목록을 못 찾았으면 진입 페이지 자체라도 스캔해본다 (한 페이지에 다 있는 구조일 수 있다).
      const court = {
        id: `ksponco:${KSPONCO.id}`,
        source: 'ksponco',
        name: KSPONCO.name,
        place: KSPONCO.name,
        district: KSPONCO.district,
        status: '확인필요',
        paid: true,
        target: '',
        tel: '',
        receiptFrom: null,
        receiptTo: null,
        useFrom: null,
        useTo: null,
        url: KSPONCO.entryUrl,
        lng: null,
        lat: null,
      };
      courts.push(court);

      const result = await scanUrl(context, KSPONCO.entryUrl);
      if (!result.ok) {
        errors.push({ courtId: court.id, url: KSPONCO.entryUrl, error: result.error });
      } else {
        const s = toSlots(court.id, result.scan);
        slots.push(...s);
        if (s.length === 0) {
          errors.push({
            courtId: court.id,
            url: KSPONCO.entryUrl,
            error: '코트 링크도 달력도 못 찾음 (SELECTORS.ksponco.courtLink 확인 필요)',
          });
        }
      }
      return { courts, slots, errors };
    }

    log.info(`올림픽테니스장 코트 ${links.length}면`);
    const perCourt = await pool(links, CONFIG.concurrency, async (link) => {
      const id = `ksponco:${new URL(link.href).searchParams.toString() || link.name}`;
      const court = {
        id,
        source: 'ksponco',
        name: `${KSPONCO.name} ${link.name}`.trim(),
        place: KSPONCO.name,
        district: KSPONCO.district,
        status: '접수중',
        paid: true,
        target: '',
        tel: '',
        receiptFrom: null,
        receiptTo: null,
        useFrom: null,
        useTo: null,
        url: link.href,
        lng: null,
        lat: null,
      };

      const result = await scanUrl(context, link.href);
      if (!result.ok) {
        errors.push({ courtId: id, url: link.href, error: result.error });
        return { court, slots: [] };
      }
      return { court, slots: toSlots(id, result.scan) };
    });

    for (const r of perCourt) {
      if (!r) continue;
      courts.push(r.court);
      slots.push(...r.slots);
    }

    log.info(`올림픽테니스장 슬롯 ${slots.length}건 / 실패 ${errors.length}건`);
    return { courts, slots, errors };
  } finally {
    await browser.close().catch(() => {});
  }
}
