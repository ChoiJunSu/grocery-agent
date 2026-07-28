// 예약 페이지에서 "언제 비어 있나"를 구조에 기대지 않고 뽑아내는 스캐너.
//
// 왜 셀렉터가 아니라 휴리스틱인가:
// yeyak / ksponco 는 각각 다른 레거시 시스템이고 코트마다 달력 마크업이 조금씩 다르다.
// 대신 두 시스템 모두 화면에 반드시 (a) 날짜 숫자, (b) 시간대 문자열, (c) 상태 한글
// ('예약가능' / '마감' 등)을 렌더링한다. 그 세 가지 텍스트를 앵커로 삼는다.
//
// 스캐너는 두 종류를 모두 수집한다:
//   dayCells  — 월 달력의 날짜 칸 (그 날 예약 가능 여부)
//   timeSlots — 시간표의 시간대 칸 (해당 시간 예약 가능 여부)
// 사이트에 따라 둘 중 하나만 나오는 게 정상이다.

/**
 * page.evaluate에 넘길 함수. 클로저를 못 쓰므로 필요한 값은 arg로 전부 받는다.
 * @param {{timeRangeSrc: string, stateRules: {source: string, state: string}[]}} arg
 */
export function scanFn(arg) {
  const timeRe = new RegExp(arg.timeRangeSrc);
  const rules = arg.stateRules.map((r) => ({ re: new RegExp(r.source), state: r.state }));

  const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

  /**
   * 요소 자신 + 조상 3단계의 class/aria/disabled를 훑어 상태를 판정한다.
   *
   * withSiblings=true면 바로 앞뒤 형제의 텍스트도 본다. 시간표가
   * <td>06:00~08:00</td><td>예약가능</td> 처럼 상태를 옆 칸에 두는 경우가 많기 때문이다.
   * 달력 날짜 칸에는 쓰면 안 된다 — 옆 칸이 다른 날짜라 상태가 섞인다.
   */
  const stateOf = (el, withSiblings = false) => {
    const parts = [text(el)];
    if (withSiblings) {
      parts.push(text(el.previousElementSibling ?? el), text(el.nextElementSibling ?? el));
    }
    let node = el;
    for (let i = 0; i < 3 && node; i++) {
      parts.push(node.className || '', node.getAttribute?.('aria-label') || '');
      if (node.disabled || node.getAttribute?.('aria-disabled') === 'true') parts.push('마감');
      node = node.parentElement;
    }
    const hay = parts.join(' ');
    for (const r of rules) if (r.re.test(hay)) return r.state;
    return 'unknown';
  };

  /** 텍스트를 직접 들고 있는 최말단 요소만 (부모가 자식 텍스트를 중복 보고하는 걸 막는다) */
  const leaves = [];
  for (const el of document.querySelectorAll('td, li, button, a, div, span, p')) {
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();
    if (own) leaves.push({ el, own });
  }

  // ---------- 1. 화면에 걸린 년/월, 그리고 선택된 날짜 ----------
  const bodyText = document.body.innerText;

  let year = null;
  let month = null;
  const monthMatch = bodyText.match(/(\d{4})\s*[.\-년]\s*(\d{1,2})\s*[.\-월]?/);
  if (monthMatch) {
    year = Number(monthMatch[1]);
    month = Number(monthMatch[2]);
  }

  // 시간표는 "선택된 날짜"의 시간표라 그 날짜가 어딘가 전체 형식으로 찍혀 있다.
  // 접수기간 같은 다른 날짜를 잡을 수 있으니 확정이 아니라 후보로만 넘긴다.
  let pageDate = null;
  const dateMatch = bodyText.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/);
  if (dateMatch) {
    const [, y, mo, d] = dateMatch;
    pageDate = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // ---------- 2. 시간대 슬롯 ----------
  const timeSlots = [];
  const seenTime = new Set();
  for (const { el } of leaves) {
    const t = text(el);
    const m = t.match(timeRe);
    if (!m) continue;
    // 컨테이너가 자식 시간대를 통째로 담은 경우 걸러낸다 (시간 표기가 2개 이상)
    if ((t.match(new RegExp(timeRe.source, 'g')) || []).length > 1) continue;

    const start = `${String(m[1]).padStart(2, '0')}:${m[2] ?? '00'}`;
    const end = `${String(m[3]).padStart(2, '0')}:${m[4] ?? '00'}`;
    const key = `${start}-${end}-${t}`;
    if (seenTime.has(key)) continue;
    seenTime.add(key);

    timeSlots.push({ start, end, label: t.slice(0, 80), state: stateOf(el, true) });
  }

  // ---------- 3. 월 달력의 날짜 칸 ----------
  // 달력은 보통 <table>이고, 날짜 칸은 '1'~'31' 숫자로 시작한다.
  const dayCells = [];
  const seenDay = new Set();
  for (const table of document.querySelectorAll('table, ul, ol')) {
    const cells = table.querySelectorAll('td, li');
    if (cells.length < 14) continue; // 달력이라기엔 칸이 너무 적다

    for (const cell of cells) {
      const t = text(cell);
      const m = t.match(/^(\d{1,2})(?!\d)/);
      if (!m) continue;
      const day = Number(m[1]);
      if (day < 1 || day > 31) continue;
      if (seenDay.has(day)) continue;

      const dataDate = cell.getAttribute('data-date') || cell.querySelector('[data-date]')?.getAttribute('data-date');
      seenDay.add(day);
      dayCells.push({
        day,
        dataDate: dataDate || null,
        label: t.slice(0, 60),
        state: stateOf(cell),
      });
    }
    if (dayCells.length > 0) break; // 첫 달력만 쓴다
  }

  return {
    title: document.title,
    url: location.href,
    year,
    month,
    pageDate,
    dayCells,
    timeSlots,
    // 아무것도 못 뽑았을 때 원인 파악용 (diagnose가 출력한다)
    sample: document.body.innerText.replace(/\s+/g, ' ').slice(0, 600),
  };
}

/** scanFn에 넘길 인자 — 정규식은 문자열로 직렬화해서 보낸다 */
export function scanArg(timeRangeRe, stateRules) {
  return {
    timeRangeSrc: timeRangeRe.source,
    stateRules: stateRules.map((r) => ({ source: r.re.source, state: r.state })),
  };
}

/**
 * 스캔 결과 → Slot 배열.
 * 날짜를 확정할 수 없으면 그 슬롯은 버린다 — 엉뚱한 날짜로 채우지 않는다.
 */
export function toSlots(courtId, scan, fallbackDate = null) {
  const slots = [];

  const dateOf = (day) => {
    if (!scan.year || !scan.month) return null;
    return `${scan.year}-${String(scan.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  for (const cell of scan.dayCells) {
    const date = cell.dataDate || dateOf(cell.day);
    if (!date) continue;
    slots.push({ courtId, date, start: null, end: null, state: cell.state, label: cell.label });
  }

  // 시간표는 "지금 선택된 날짜" 기준이다. 호출자가 알려준 날짜를 먼저 쓰고,
  // 없으면 페이지에서 읽은 날짜를 쓴다. 둘 다 없으면 버린다.
  const timeDate = fallbackDate ?? scan.pageDate;
  if (timeDate) {
    for (const s of scan.timeSlots) {
      slots.push({ courtId, date: timeDate, start: s.start, end: s.end, state: s.state, label: s.label });
    }
  }

  return slots;
}
