import { describe, expect, it } from 'vitest';
import { matchProduct, nameSimilarity, normalizeName, PRODUCT_ALIASES } from '../src/matching.js';
import { MOCK_PRODUCTS } from '../src/mocks.js';

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
    const m = matchProduct('[행사] 3겹 화장지 30롤 데코', MOCK_PRODUCTS);
    expect(m?.productId).toBe('tissue-30');
  });

  it('별칭 테이블이 퍼지 매칭보다 우선한다', () => {
    const m = matchProduct('곰곰 무항생제 신선한 대란 30구', MOCK_PRODUCTS, PRODUCT_ALIASES.coupang);
    expect(m).toEqual({ productId: 'eggs-30', score: 1 });
  });

  it('임계값 미만이면 null (오매핑 방지)', () => {
    expect(matchProduct('강아지 사료 2kg', MOCK_PRODUCTS)).toBeNull();
  });

  it('수량/단위가 같은 계열 상품과 헷갈리지 않는다', () => {
    const m = matchProduct('무항생제 계란 30구 프리미엄', MOCK_PRODUCTS);
    expect(m?.productId).toBe('eggs-30');
  });
});
