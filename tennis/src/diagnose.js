// 셀렉터/휴리스틱 진단기 (grocery-agent 익스텐션의 DIAGNOSE와 같은 역할).
//
// 실페이지에서 무엇이 잡히고 무엇이 안 잡히는지 그대로 보여준다.
// 슬롯이 0건일 때 여기부터 돌리면 원인이 바로 나온다.
//
//   npm run diagnose -- https://yeyak.seoul.go.kr/web/reservation/selectReservView.do?rsv_svc_id=S...
//   npm run diagnose -- https://www.ksponco.or.kr/online/tennis/index.do
//   npm run diagnose -- <url> --html   HTML 원문을 data/diagnose.html로 덤프

import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, log, ROOT } from './util.js';

loadEnv();

const { SELECTORS, TIME_RANGE_RE, STATE_RULES, CONFIG } = await import('./config.js');
const { openBrowser } = await import('./sources/browser.js');
const { scanFn, scanArg, toSlots } = await import('./sources/pageScan.js');

const url = process.argv.slice(2).find((a) => a.startsWith('http'));
const dumpHtml = process.argv.includes('--html');

if (!url) {
  console.error('사용법: npm run diagnose -- <url> [--html]');
  process.exit(1);
}

const { browser, context } = await openBrowser();
const page = await context.newPage();

try {
  log.info(`열기: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.navTimeoutMs });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  // ---------- 셀렉터 후보별 매칭 수 ----------
  // yeyak/ksponco에 같은 이름의 그룹이 있어 접두사를 붙여야 서로 덮어쓰지 않는다.
  const groups = {};
  for (const [site, byName] of Object.entries(SELECTORS)) {
    for (const [name, candidates] of Object.entries(byName)) groups[`${site}.${name}`] = candidates;
  }
  const counts = await page.evaluate((g) => {
    const out = {};
    for (const [name, candidates] of Object.entries(g)) {
      out[name] = candidates.map((sel) => {
        try {
          return { sel, n: document.querySelectorAll(sel).length };
        } catch {
          return { sel, n: -1 }; // 문법 오류
        }
      });
    }
    return out;
  }, groups);

  console.log('\n=== 셀렉터 후보 매칭 수 ===');
  for (const [name, results] of Object.entries(counts)) {
    const hit = results.find((r) => r.n > 0);
    console.log(`${hit ? '✓' : '✗'} ${name}`);
    for (const r of results) console.log(`    ${String(r.n).padStart(5)}  ${r.sel}`);
  }

  // ---------- 휴리스틱 스캔 결과 ----------
  const scan = await page.evaluate(scanFn, scanArg(TIME_RANGE_RE, STATE_RULES));

  console.log('\n=== 휴리스틱 스캔 ===');
  console.log(`제목      : ${scan.title}`);
  console.log(`인식한 년월: ${scan.year ?? '?'}-${scan.month ?? '?'}`);
  console.log(`페이지 날짜: ${scan.pageDate ?? '없음'}  ← 시간표 슬롯이 이 날짜로 기록된다. 틀렸으면 의심할 것`);
  console.log(`날짜 칸    : ${scan.dayCells.length}개`);
  for (const c of scan.dayCells.slice(0, 10)) {
    console.log(`    ${String(c.day).padStart(2)}일  ${c.state.padEnd(9)} "${c.label}"`);
  }
  console.log(`시간대 칸  : ${scan.timeSlots.length}개`);
  for (const s of scan.timeSlots.slice(0, 10)) {
    console.log(`    ${s.start}~${s.end}  ${s.state.padEnd(9)} "${s.label}"`);
  }

  const slots = toSlots('diagnose', scan);
  console.log(`\n최종 슬롯  : ${slots.length}건`);
  if (slots.length === 0) {
    console.log('\n본문 앞부분 (패턴이 왜 안 걸렸는지 확인용):');
    console.log(scan.sample);
    console.log('\n→ 날짜/시간/상태 텍스트가 iframe 안이나 클릭 후에만 렌더링되는지 확인할 것.');
  }

  if (dumpHtml) {
    const out = path.join(ROOT, 'data', 'diagnose.html');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, await page.content());
    console.log(`\nHTML 덤프: ${path.relative(process.cwd(), out)}`);
  }

  // iframe이 있으면 알려준다 — 레거시 예약 시스템에서 흔한 함정.
  const frames = page.frames().filter((f) => f !== page.mainFrame());
  if (frames.length > 0) {
    console.log(`\n⚠ iframe ${frames.length}개 발견 — 달력이 이 안에 있을 수 있다:`);
    for (const f of frames) console.log(`    ${f.url()}`);
  }
} finally {
  await browser.close().catch(() => {});
}
