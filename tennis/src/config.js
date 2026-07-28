// 수집 대상과 셀렉터 후보를 한곳에 모아둔다.
//
// 중요: yeyak / ksponco 의 DOM 셀렉터는 아직 실사이트로 검증되지 않았다.
// (개발 환경에서 두 도메인이 네트워크 차단되어 확인 불가)
// 그래서 슬롯 추출은 셀렉터에 먼저 기대지 않고, 날짜/시간/상태 텍스트 패턴을 훑는
// 구조 비의존 휴리스틱(extractSlotsFromPage)을 1차로 쓴다.
// SELECTORS는 휴리스틱이 헛짚을 때 범위를 좁혀주는 힌트다.
//
// 셀렉터를 실사이트에 맞춰 고정하려면 `npm run diagnose` 를 돌려 후보별 매칭 수를 확인하고,
// 맞는 값을 해당 배열 맨 앞에 추가하면 된다.

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const CONFIG = {
  apiKey: process.env.SEOUL_API_KEY ?? '',
  days: num(process.env.TENNIS_DAYS, 30),
  concurrency: num(process.env.TENNIS_CONCURRENCY, 3),
  port: num(process.env.TENNIS_PORT, 3100),
  // 공공 사이트 예의: 페이지 하나 열고 나서 최소 이만큼 쉰다 (ms)
  politeDelayMs: 700,
  navTimeoutMs: 20000,
};

/** 서울 열린데이터광장 체육시설 예약정보 (OA-2266) */
export const SEOUL_API = {
  // openapi.seoul.go.kr 은 8088 포트에서만 서비스한다. https 미지원.
  base: 'http://openapi.seoul.go.kr:8088',
  service: 'ListPublicReservationSport',
  pageSize: 1000, // API 1회 최대 행 수
  // SVCNM/MINCLASSNM/PLACENM 중 하나라도 걸리면 테니스로 본다.
  // '테니스교실' 같은 강습은 코트 대관이 아니므로 뒤에서 걸러낸다.
  includePattern: /테니스/,
  excludePattern: /(교실|강습|레슨|아카데미|스쿨|대회|리그|초등|유소년)/,
};

/** 코트 상세 페이지 URL (SVCURL이 비어 있을 때 조립용) */
export const yeyakDetailUrl = (svcId) =>
  `https://yeyak.seoul.go.kr/web/reservation/selectReservView.do?rsv_svc_id=${encodeURIComponent(svcId)}`;

/** 올림픽테니스장 (국민체육진흥공단) — yeyak과 별도 시스템 */
export const KSPONCO = {
  id: 'ksponco',
  name: '올림픽테니스장',
  district: '송파구',
  entryUrl: 'https://www.ksponco.or.kr/online/tennis/index.do',
};

// ---------- 슬롯 판정에 쓰는 텍스트 패턴 ----------

/** "09:00~11:00", "09:00 - 11:00", "9시~11시" 를 모두 잡는다 */
export const TIME_RANGE_RE =
  /(\d{1,2})\s*(?::\s*(\d{2})|시)\s*[~\-–—]\s*(\d{1,2})\s*(?::\s*(\d{2})|시)/;

/** "2026-07-30", "2026.07.30", "7/30" */
export const DATE_RE = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})|(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?:[^\d]|$)/;

/**
 * 상태 텍스트 → 슬롯 상태.
 * 앞에 있는 규칙이 우선한다 ('예약마감'이 '예약'보다 먼저 걸려야 한다).
 */
export const STATE_RULES = [
  { re: /(마감|완료|불가|종료|신청불가|예약중|대기)/, state: 'closed' },
  { re: /(가능|신청|접수중|예약하기|잔여|여유|빈)/, state: 'available' },
];

/** 슬롯 후보를 담고 있을 법한 컨테이너. 없으면 document 전체를 훑는다. */
export const SELECTORS = {
  yeyak: {
    // 달력/시간표 영역
    slotContainer: [
      '.reserve_calendar',
      '.calendar_wrap',
      '#calendarArea',
      'table.tbl_calendar',
      '[class*="calendar"]',
      '[class*="reserv"] table',
    ],
    // 시간대 한 칸
    slotCell: ['td[class*="time"]', 'li[class*="time"]', 'td', 'li'],
    // 코트명/장소 (API 값과 대조용)
    title: ['.tit_view', 'h2.tit', '.view_tit', 'h2', 'h3'],
  },
  ksponco: {
    // 코트 선택 → 날짜 선택 → 시간표 순으로 이동하는 예약 시스템
    courtLink: ['a[href*="tennis"]', '.court_list a', '[class*="court"] a'],
    slotContainer: ['table', '.time_table', '[class*="calendar"]'],
    slotCell: ['td', 'li'],
  },
};
