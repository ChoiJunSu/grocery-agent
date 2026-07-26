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

/**
 * 용량 단위를 대표 단위로 환산해 "1000ml"과 "1l"이 서로 다른 문자열로 갈리는 것을 막는다.
 * 실제로 컬리는 "우유 1000mL", 카탈로그는 "1L"로 적혀 매칭이 0건이었다.
 */
export function normalizeUnits(name: string): string {
  return name.replace(/(\d+(?:\.\d+)?)ml/g, (_, n) => `${Number((Number(n) / 1000).toFixed(3))}l`);
}

/**
 * 비교에 쓸 이름 변형들.
 *
 * 대괄호는 마트마다 의미가 정반대다 — 이마트는 "[이마트] 우유"처럼 노이즈를 넣지만
 * 컬리는 "[서울우유] 나 100% 우유"처럼 **브랜드**를 넣는다. 어느 쪽이 맞는지 미리
 * 알 수 없으므로 두 해석을 모두 만들어 가장 잘 맞는 쪽을 채택한다.
 */
function nameVariants(name: string): string[] {
  const bracketsDropped = normalizeName(name);
  const bracketsKept = normalizeName(name.replace(/[[\]()]/g, ' '));
  const all = [bracketsDropped, bracketsKept].flatMap((v) => [v, normalizeUnits(v)]);
  return [...new Set(all)].filter((v) => v.length > 0);
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/**
 * Dice coefficient (0~1). 대괄호 해석과 용량 단위 표기가 마트마다 달라
 * 양쪽 이름의 변형들을 모두 대조해 가장 높은 점수를 채택한다.
 */
export function nameSimilarity(a: string, b: string): number {
  let best = 0;
  for (const va of nameVariants(a)) {
    for (const vb of nameVariants(b)) {
      const score = similarityOf(va, vb);
      if (score > best) best = score;
    }
  }
  return best;
}

/** 정규화가 끝난 두 문자열의 유사도 */
function similarityOf(na: string, nb: string): number {
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
  if (aliases) {
    // 별칭 테이블에 어떤 표기로 넣었든 잡히도록 변형을 모두 조회한다
    for (const variant of nameVariants(siteName)) {
      if (aliases[variant]) return { productId: aliases[variant], score: 1 };
    }
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
  // 2026-07-26 www.kurly.com/search 실DOM에서 관측한 표기
  kurly: {
    [normalizeName('서울우유 나 100% 우유 1000mL')]: 'milk-1l',
  },
};
