// 서울 열린데이터광장 '체육시설 공공서비스예약 정보'(OA-2266)에서 테니스 코트 목록을 받는다.
//
// 이 API가 주는 것: 코트(=예약 서비스) 단위 메타데이터 + 접수상태 + 접수/이용 기간.
// 이 API가 주지 않는 것: 날짜×시간대별 잔여 슬롯. 그건 yeyakSlots.js가 상세 페이지에서 긁는다.

import { SEOUL_API, yeyakDetailUrl } from '../config.js';
import { log, parseApiDate } from '../util.js';

/** 오픈API 한 페이지를 받는다 */
async function fetchPage(apiKey, start, end) {
  const url = `${SEOUL_API.base}/${apiKey}/json/${SEOUL_API.service}/${start}/${end}/`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`오픈API HTTP ${res.status} (${url.replace(apiKey, '***')})`);

  const json = await res.json();

  // 인증키 오류 등은 HTTP 200 + RESULT 코드로 온다.
  if (json.RESULT) throw new Error(`오픈API 오류 ${json.RESULT.CODE}: ${json.RESULT.MESSAGE}`);

  const body = json[SEOUL_API.service];
  if (!body) throw new Error(`응답에 ${SEOUL_API.service} 없음: ${JSON.stringify(json).slice(0, 200)}`);
  if (body.RESULT && !/INFO-000/.test(body.RESULT.CODE)) {
    throw new Error(`오픈API 오류 ${body.RESULT.CODE}: ${body.RESULT.MESSAGE}`);
  }
  return { total: Number(body.list_total_count ?? 0), rows: body.row ?? [] };
}

/** 강습/대회가 아닌 '코트 대관'만 남긴다 */
function isCourtRental(row) {
  const haystack = [row.SVCNM, row.MINCLASSNM, row.PLACENM, row.DTLCONT].join(' ');
  if (!SEOUL_API.includePattern.test(haystack)) return false;
  // 서비스명에 강습 성격이 드러나면 제외 (상세설명은 잡음이 많아 보지 않는다)
  return !SEOUL_API.excludePattern.test(String(row.SVCNM ?? ''));
}

/** API 행 → 내부 Court 모델 */
function toCourt(row) {
  const svcId = String(row.SVCID ?? '').trim();
  return {
    id: `yeyak:${svcId}`,
    source: 'yeyak',
    svcId,
    name: String(row.SVCNM ?? '').trim(),
    place: String(row.PLACENM ?? '').trim(),
    district: String(row.AREANM ?? '').trim(),
    status: String(row.SVCSTATNM ?? '').trim(),
    paid: String(row.PAYATNM ?? '').includes('유료'),
    target: String(row.USETGTINFO ?? '').trim(),
    tel: String(row.TELNO ?? '').trim(),
    receiptFrom: parseApiDate(row.RCPTBGNDT),
    receiptTo: parseApiDate(row.RCPTENDDT),
    useFrom: parseApiDate(row.SVCOPNBGNDT),
    useTo: parseApiDate(row.SVCOPNENDDT),
    url: String(row.SVCURL ?? '').trim() || yeyakDetailUrl(svcId),
    // 서울시 데이터셋은 X=경도, Y=위도로 싣는다. 값이 비면 null.
    lng: Number(row.X) || null,
    lat: Number(row.Y) || null,
  };
}

/**
 * 테니스 코트 전체 목록.
 * 인증키가 없으면 던진다 — 빈 배열로 조용히 넘어가면 "코트가 0개"와 구별이 안 된다.
 */
export async function fetchTennisCourts(apiKey) {
  if (!apiKey) {
    throw new Error('SEOUL_API_KEY가 비어 있다. .env.example을 .env로 복사하고 키를 채울 것.');
  }

  const courts = [];
  let start = 1;
  let total = Infinity;

  while (start <= total) {
    const end = start + SEOUL_API.pageSize - 1;
    const { total: t, rows } = await fetchPage(apiKey, start, end);
    total = t;
    if (rows.length === 0) break;

    for (const row of rows) {
      if (isCourtRental(row)) courts.push(toCourt(row));
    }
    log.info(`오픈API ${start}~${Math.min(end, total)} / ${total} — 누적 테니스 코트 ${courts.length}건`);
    start = end + 1;
  }

  // 같은 SVCID가 중복으로 실리는 경우가 있어 한 번 정리한다.
  const unique = new Map(courts.map((c) => [c.id, c]));
  return [...unique.values()];
}
