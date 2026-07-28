// 공용 유틸 — 로그, 동시 실행 제한, 날짜 포맷, .env 로딩.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** dotenv 의존성 없이 .env 를 읽는다 (이미 설정된 환경변수가 우선) */
export function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export const log = {
  info: (...a) => console.log('[tennis]', ...a),
  warn: (...a) => console.warn('[tennis]', ...a),
  error: (...a) => console.error('[tennis]', ...a),
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** items를 limit개씩 동시에 worker에 태운다. 개별 실패는 null로 남기고 전체는 계속 진행. */
export async function pool(items, limit, worker) {
  const results = new Array(items.length).fill(null);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        log.warn(`항목 ${i} 실패:`, err.message);
        results[i] = null;
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/** Date → 'YYYY-MM-DD' (KST 기준) */
export function ymd(date) {
  const kst = new Date(date.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** 오늘부터 n일치 'YYYY-MM-DD' 배열 */
export function dateRange(n, from = new Date()) {
  return Array.from({ length: n }, (_, i) => ymd(new Date(from.getTime() + i * 86400000)));
}

/**
 * 서울 오픈API의 'YYYY-MM-DD HH:mm:ss.S' 형식을 ISO 문자열로.
 * 파싱 불가면 원문을 그대로 돌려준다 — 임의의 날짜로 대신하지 않는다.
 */
export function parseApiDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[-.]?(\d{2})[-.]?(\d{2})[ T]?(\d{2})?:?(\d{2})?/);
  if (!m) return s;
  const [, y, mo, d, h = '00', mi = '00'] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:00+09:00`;
}
