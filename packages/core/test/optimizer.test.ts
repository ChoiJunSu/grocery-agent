import { describe, expect, it } from 'vitest';
import { optimize, pickBestCoupon } from '../src/optimizer.js';
import { MOCK_COUPONS, MOCK_MARTS, MOCK_OFFERS, MOCK_PRODUCTS, MOCK_SLOTS } from '../src/mocks.js';
import type { Coupon, Mart, Offer, OptimizeInput, Product } from '../src/types.js';

const martA: Mart = { id: 'a', name: 'A마트', shippingFee: 3000, freeShippingThreshold: 40000, cartUrl: '' };
const martB: Mart = { id: 'b', name: 'B마트', shippingFee: 3000, freeShippingThreshold: 30000, cartUrl: '' };

const products: Product[] = [
  { id: 'p1', name: '상품1', unit: '' },
  { id: 'p2', name: '상품2', unit: '' },
  { id: 'p3', name: '상품3', unit: '' },
];

function input(partial: Partial<OptimizeInput>): OptimizeInput {
  return {
    items: [],
    products,
    marts: [martA, martB],
    offers: [],
    coupons: [],
    slots: [],
    ...partial,
  };
}

describe('pickBestCoupon', () => {
  const coupons: Coupon[] = [
    { id: 'c1', martId: 'a', name: '10%', type: 'percent', value: 10, minOrder: 30000, maxDiscount: 4000 },
    { id: 'c2', martId: 'a', name: '3천원', type: 'fixed', value: 3000, minOrder: 20000 },
  ];

  it('minOrder 미달 쿠폰은 제외한다', () => {
    expect(pickBestCoupon(coupons, 10000)).toBeNull();
    expect(pickBestCoupon(coupons, 25000)?.couponId).toBe('c2');
  });

  it('할인액이 가장 큰 쿠폰을 고른다', () => {
    // 35000의 10% = 3500 > 3000
    expect(pickBestCoupon(coupons, 35000)?.discount).toBe(3500);
  });

  it('percent 쿠폰은 maxDiscount로 상한된다', () => {
    expect(pickBestCoupon(coupons, 100000)?.discount).toBe(4000);
  });
});

describe('optimize — 배송비/쿠폰 상호작용', () => {
  it('품목별 최저가로 쪼개는 것보다 배송비 아끼려 한 마트로 합치는 게 싸면 합친다', () => {
    // p1은 A가 100원 싸고 p2는 B가 100원 싸지만, 쪼개면 배송비 3000+3000
    const offers: Offer[] = [
      { martId: 'a', productId: 'p1', price: 9900, available: true },
      { martId: 'b', productId: 'p1', price: 10000, available: true },
      { martId: 'a', productId: 'p2', price: 10000, available: true },
      { martId: 'b', productId: 'p2', price: 9900, available: true },
    ];
    const plan = optimize(
      input({
        items: [
          { productId: 'p1', quantity: 1 },
          { productId: 'p2', quantity: 1 },
        ],
        offers,
      }),
    );
    expect(plan.baskets).toHaveLength(1);
    // 어느 마트든 소계 19900 + 배송비 3000 = 22900 < 쪼갠 25900
    expect(plan.grandTotal).toBe(22900);
  });

  it('무료배송 기준을 넘기면 배송비를 부과하지 않는다 (경계값 포함)', () => {
    const offers: Offer[] = [
      { martId: 'b', productId: 'p1', price: 30000, available: true },
    ];
    const plan = optimize(input({ items: [{ productId: 'p1', quantity: 1 }], offers }));
    expect(plan.baskets[0].shippingFee).toBe(0);
    expect(plan.grandTotal).toBe(30000);
  });

  it('쿠폰 minOrder를 채우기 위해 품목을 한 마트로 몰아주는 조합을 찾는다', () => {
    // 개별 최저가는 p1=A, p2=B. 그러나 B에 몰면 소계 40000 → 8000원 쿠폰 발동
    const offers: Offer[] = [
      { martId: 'a', productId: 'p1', price: 19000, available: true },
      { martId: 'b', productId: 'p1', price: 20000, available: true },
      { martId: 'a', productId: 'p2', price: 21000, available: true },
      { martId: 'b', productId: 'p2', price: 20000, available: true },
    ];
    const coupons: Coupon[] = [
      { id: 'big', martId: 'b', name: '8천원', type: 'fixed', value: 8000, minOrder: 40000 },
    ];
    const plan = optimize(
      input({
        items: [
          { productId: 'p1', quantity: 1 },
          { productId: 'p2', quantity: 1 },
        ],
        offers,
        coupons,
      }),
    );
    expect(plan.baskets).toHaveLength(1);
    expect(plan.baskets[0].martId).toBe('b');
    expect(plan.baskets[0].coupon?.discount).toBe(8000);
    expect(plan.grandTotal).toBe(32000); // 40000 - 8000, 배송비 무료
  });

  it('모든 마트에서 품절인 상품은 unassigned로 분리하고 나머지는 계속 최적화한다', () => {
    const offers: Offer[] = [
      { martId: 'a', productId: 'p1', price: 5000, available: true },
      { martId: 'a', productId: 'p2', price: 1000, available: false },
      { martId: 'b', productId: 'p2', price: 1000, available: false },
    ];
    const plan = optimize(
      input({
        items: [
          { productId: 'p1', quantity: 2 },
          { productId: 'p2', quantity: 1 },
        ],
        offers,
      }),
    );
    expect(plan.unassigned).toHaveLength(1);
    expect(plan.unassigned[0].productId).toBe('p2');
    expect(plan.baskets[0].subtotal).toBe(10000);
  });

  it('수량이 단가에 곱해진다', () => {
    const offers: Offer[] = [{ martId: 'a', productId: 'p1', price: 2500, available: true }];
    const plan = optimize(input({ items: [{ productId: 'p1', quantity: 4 }], offers }));
    expect(plan.baskets[0].lines[0].lineTotal).toBe(10000);
  });
});

describe('optimize — mock 전체 데이터', () => {
  const allItems = MOCK_PRODUCTS.map((p) => ({ productId: p.id, quantity: 1 }));
  const full: OptimizeInput = {
    items: allItems,
    products: MOCK_PRODUCTS,
    marts: MOCK_MARTS,
    offers: MOCK_OFFERS,
    coupons: MOCK_COUPONS,
    slots: MOCK_SLOTS,
  };

  it('전수 탐색으로 단일 마트 최저 baseline보다 같거나 싼 해를 찾는다', () => {
    const plan = optimize(full);
    expect(plan.strategy).toBe('exhaustive');
    expect(plan.unassigned).toHaveLength(0);
    const feasible = plan.baselines.filter((b) => b.total !== null);
    expect(feasible.length).toBeGreaterThan(0);
    for (const b of feasible) {
      expect(plan.grandTotal).toBeLessThanOrEqual(b.total!);
    }
    expect(plan.savings).not.toBeNull();
    expect(plan.savings!).toBeGreaterThanOrEqual(0);
  });

  it('사용 마트마다 예약 가능한 가장 빠른 슬롯을 붙인다', () => {
    const plan = optimize(full);
    for (const basket of plan.baskets) {
      if (basket.slot) {
        expect(basket.slot.martId).toBe(basket.martId);
        expect(basket.slot.available).toBe(true);
      }
    }
    const emart = plan.baskets.find((b) => b.martId === 'emart');
    if (emart?.slot) expect(emart.slot.timeRange).toBe('14:00~17:00'); // 예약 불가 슬롯 스킵
  });

  it('조합 수가 한도를 넘으면 greedy로 전환하되 유효한 계획을 낸다', () => {
    // 상품 20개 x 3마트 = 3^20 조합 → greedy
    const manyProducts: Product[] = Array.from({ length: 20 }, (_, i) => ({
      id: `bulk-${i}`,
      name: `벌크상품${i}`,
      unit: '',
    }));
    const manyOffers: Offer[] = manyProducts.flatMap((p, i) =>
      MOCK_MARTS.map((m, j) => ({
        martId: m.id,
        productId: p.id,
        price: 3000 + i * 100 + j * 50,
        available: true,
      })),
    );
    const plan = optimize({
      items: manyProducts.map((p) => ({ productId: p.id, quantity: 1 })),
      products: manyProducts,
      marts: MOCK_MARTS,
      offers: manyOffers,
      coupons: MOCK_COUPONS,
      slots: MOCK_SLOTS,
    });
    expect(plan.strategy).toBe('greedy');
    expect(plan.unassigned).toHaveLength(0);
    const assignedCount = plan.baskets.reduce((acc, b) => acc + b.lines.length, 0);
    expect(assignedCount).toBe(20);
    // greedy도 단일 마트 최저 baseline보다 비싸면 안 된다 (지역 개선이 그 방향을 커버)
    const feasible = plan.baselines.filter((b) => b.total !== null);
    for (const b of feasible) {
      expect(plan.grandTotal).toBeLessThanOrEqual(b.total!);
    }
  });
});
