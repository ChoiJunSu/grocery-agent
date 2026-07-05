import type { Product } from './types.js';

/**
 * 마트 사이트의 상품명 ↔ 내부 카탈로그 productId 매핑.
 *
 * 1) 별칭 테이블(정규화된 사이트 상품명 → productId) 정확 매칭
 * 2) 정규화 후 완전 일치
 * 3) 문자 바이그램 Dice 유사도 (한국어는 띄어쓰기가 불규칙해 토큰 분리보다 안정적)
 */

/** 브랜드 대괄호, 공백, 특수문자 제거 + 소문자화. "1L" 같은 단위는 비교에 유의미하므로 남긴다. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '') // [이마트], [행사] 등 대괄호 블록 제거
    .replace(/\([^)]*\)/g, '') // 괄호 안 부가설명 제거
    .replace(/[^0-9a-z가-힣]/g, ''); // 공백/기호 제거
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** Dice coefficient (0~1) */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return na === nb ? 1 : 0;
  let inter = 0;
  for (const g of ba) if (bb.has(g)) inter++;
  const dice = (2 * inter) / (ba.size + bb.size);
  // 사이트명이 "브랜드+수식어+카탈로그명" 형태로 길어지는 경우가 많아,
  // 짧은 쪽 바이그램이 긴 쪽에 대부분 포함되면 높은 점수를 준다.
  const containment = inter / Math.min(ba.size, bb.size);
  return Math.max(dice, containment * 0.9);
}

export interface MatchResult {
  productId: string;
  score: number;
}

export const MATCH_THRESHOLD = 0.55;

/**
 * 사이트 상품명을 카탈로그 상품으로 매핑. 확신이 없으면(임계값 미만) null.
 * @param aliases 정규화된 사이트 상품명 → productId 수동 매핑 (마트별로 축적)
 */
export function matchProduct(
  siteName: string,
  products: Product[],
  aliases?: Record<string, string>,
): MatchResult | null {
  const normalized = normalizeName(siteName);
  if (aliases && aliases[normalized]) {
    return { productId: aliases[normalized], score: 1 };
  }
  let best: MatchResult | null = null;
  for (const p of products) {
    const score = nameSimilarity(siteName, p.name);
    if (!best || score > best.score) best = { productId: p.id, score };
  }
  return best && best.score >= MATCH_THRESHOLD ? best : null;
}

/**
 * 마트별 별칭 테이블. 실사이트에서 관찰한 상품명을 여기에 축적하면
 * 퍼지 매칭 없이 확정 매핑된다.
 */
export const PRODUCT_ALIASES: Record<string, Record<string, string>> = {
  emart: {
    [normalizeName('서울우유 나 100% 우유 1L')]: 'milk-1l',
    [normalizeName('[이마트] 무항생제 특란 30입')]: 'eggs-30',
  },
  homeplus: {
    [normalizeName('서울우유 1000ml')]: 'milk-1l',
  },
  coupang: {
    [normalizeName('서울우유 나100% 우유, 1L, 1개')]: 'milk-1l',
    [normalizeName('곰곰 무항생제 신선한 대란 30구')]: 'eggs-30',
  },
};
