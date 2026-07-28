// 수집 진입점: 오픈API로 코트 목록 → 상세 페이지에서 슬롯 → data/snapshot.json
//
//   npm run collect              전체 (yeyak + 올림픽테니스장)
//   npm run collect -- --no-slots   코트 목록/접수상태만 (빠름, 브라우저 불필요)
//   npm run collect -- --only=yeyak

import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, log, ROOT } from './util.js';

loadEnv();

const { CONFIG } = await import('./config.js');
const { fetchTennisCourts } = await import('./sources/yeyakApi.js');

const args = process.argv.slice(2);
const noSlots = args.includes('--no-slots');
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1] ?? 'all';

const snapshot = {
  collectedAt: new Date().toISOString(),
  courts: [],
  slots: [],
  errors: [],
};

// ---------- 1. yeyak 코트 목록 (오픈API) ----------
// 코트 목록은 이후 단계의 전제라 여기서 실패하면 더 진행하지 않는다.
if (only === 'all' || only === 'yeyak') {
  let courts;
  try {
    courts = await fetchTennisCourts(CONFIG.apiKey);
  } catch (err) {
    log.error(`코트 목록을 못 받았다: ${err.message}`);
    log.error('확인할 것: .env의 SEOUL_API_KEY, 그리고 openapi.seoul.go.kr:8088 접근 가능 여부(8088 포트/http)');
    process.exit(1);
  }
  log.info(`테니스 코트 ${courts.length}건`);
  snapshot.courts.push(...courts);

  if (!noSlots) {
    const { collectYeyakSlots } = await import('./sources/yeyakSlots.js');
    const { slots, errors } = await collectYeyakSlots(courts);
    snapshot.slots.push(...slots);
    snapshot.errors.push(...errors);
  }
}

// ---------- 2. 올림픽테니스장 ----------
// 별도 시스템이라 여기가 죽어도 yeyak 결과는 살려서 저장한다.
if ((only === 'all' || only === 'ksponco') && !noSlots) {
  try {
    const { collectKsponco } = await import('./sources/ksponco.js');
    const { courts, slots, errors } = await collectKsponco();
    snapshot.courts.push(...courts);
    snapshot.slots.push(...slots);
    snapshot.errors.push(...errors);
  } catch (err) {
    log.error(`올림픽테니스장 수집 실패: ${err.message}`);
    snapshot.errors.push({ courtId: 'ksponco', url: '', error: err.message });
  }
}

// ---------- 3. 저장 ----------
const outDir = path.join(ROOT, 'data');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'snapshot.json');
fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2));

log.info(
  `저장 완료 ${path.relative(process.cwd(), outFile)} — 코트 ${snapshot.courts.length} / 슬롯 ${snapshot.slots.length} / 실패 ${snapshot.errors.length}`,
);

if (snapshot.slots.length === 0 && !noSlots) {
  log.warn('슬롯이 0건이다. 셀렉터/휴리스틱이 실사이트와 안 맞을 가능성이 크다 → npm run diagnose');
}
