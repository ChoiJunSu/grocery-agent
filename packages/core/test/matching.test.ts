import { describe, expect, it } from 'vitest';
import { matchProduct, nameSimilarity, normalizeName, normalizeUnits, PRODUCT_ALIASES } from '../src/matching.js';
import { PRODUCTS } from '../src/catalog.js';

describe('normalizeName', () => {
  it('대괄호/괄호 블록과 공백, 기호를 제거한다', () => {
    expect(normalizeName('[이마트] 서울우유 1L (신선)')).toBe('서울우유1l');
    expect(normalizeName('신라면 5입')).toBe('신라면5입');
  });
});

describe('nameSimilarity', () => {
  it('띄어쓰기 차이는 동일 취급한다', () => {
    expect(nameSimilarity('서울우유 1L', '서울 우유 1 L')).toBe(1);
  });

  it('포함 관계(긴 사이트명)에 높은 점수를 준다', () => {
    expect(nameSimilarity('서울우유 나 100% 우유 1L 신선보장', '서울우유 1L')).toBeGreaterThanOrEqual(0.85);
  });

  it('무관한 상품은 낮은 점수', () => {
    expect(nameSimilarity('삼겹살 500g', '액체세제 3L')).toBeLessThan(0.3);
  });
});

describe('matchProduct', () => {
  it('사이트의 수식어 붙은 상품명을 카탈로그 상품으로 매핑한다', () => {
    const m = matchProduct('[행사] 3겹 화장지 30롤 데코', PRODUCTS);
    expect(m?.productId).toBe('tissue-30');
  });

  it('별칭 테이블이 퍼지 매칭보다 우선한다', () => {
    const m = matchProduct('곰곰 무항생제 신선한 대란 30구', PRODUCTS, PRODUCT_ALIASES.coupang);
    expect(m).toEqual({ productId: 'eggs-30', score: 1 });
  });

  it('임계값 미만이면 null (오매핑 방지)', () => {
    expect(matchProduct('강아지 사료 2kg', PRODUCTS)).toBeNull();
  });

  it('수량/단위가 같은 계열 상품과 헷갈리지 않는다', () => {
    const m = matchProduct('무항생제 계란 30구 프리미엄', PRODUCTS);
    expect(m?.productId).toBe('eggs-30');
  });
});

describe('실사이트에서 관측한 상품명 (2026-07-26 수집)', () => {
  // 컬리는 브랜드를 대괄호에 넣고("[서울우유]") 용량을 mL로 적어("1000mL"),
  // 대괄호 제거 + 단위 미환산 시 매칭이 전부 실패했다.
  it('컬리: 대괄호 안 브랜드와 mL 표기를 인식한다', () => {
    const m = matchProduct('[서울우유] 나 100% 우유 1000mL', PRODUCTS, PRODUCT_ALIASES.kurly);
    expect(m?.productId).toBe('milk-1l');
  });

  // 브랜드·용량이 다르면 매핑하지 않는다. 가격 비교는 같은 상품끼리여야 의미가 있고,
  // 사용자가 동일 취급하고 싶으면 PRODUCT_ALIASES에 직접 넣는 게 맞다.
  it('컬리: 브랜드와 용량이 다른 우유는 매핑하지 않는다', () => {
    expect(matchProduct('[연세우유 x 마켓컬리] 전용목장우유 900mL', PRODUCTS)).toBeNull();
  });

  it('normalizeUnits는 mL를 L로 환산한다', () => {
    expect(normalizeUnits('우유1000ml')).toBe('우유1l');
    expect(normalizeUnits('우유1800ml')).toBe('우유1.8l');
  });

  // 이마트는 반대로 대괄호가 노이즈다 — 기존 동작이 깨지지 않아야 한다
  it('이마트: 대괄호 브랜드 노이즈가 있어도 매핑된다', () => {
    const m = matchProduct('[이마트] 무항생제 특란 30입', PRODUCTS, PRODUCT_ALIASES.emart);
    expect(m?.productId).toBe('eggs-30');
  });

  it('쿠팡: 실제 검색 결과의 무관한 상품은 매핑하지 않는다', () => {
    expect(matchProduct('국내산 깐마늘, 1kg, 1개', PRODUCTS)).toBeNull();
    expect(matchProduct('흙대파, 1kg, 1개', PRODUCTS)).toBeNull();
  });
});
