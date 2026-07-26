import type { Coupon, DeliverySlot, Offer } from '../src/types.js';

/**
 * 최적화 엔진 테스트용 고정 데이터.
 *
 * 프로덕션 경로는 익스텐션이 수집한 실데이터만 사용한다. 이 값들은 결정적인
 * 단위 테스트를 위한 것이며 서버/익스텐션 어디에서도 불러 쓰지 않는다.
 */

export const FIXTURE_OFFERS: Offer[] = [
  { martId: 'emart', productId: 'milk-1l', price: 2980, available: true },
  { martId: 'homeplus', productId: 'milk-1l', price: 2890, available: true },
  { martId: 'coupang', productId: 'milk-1l', price: 3050, available: true },

  { martId: 'emart', productId: 'eggs-30', price: 8980, available: true },
  { martId: 'homeplus', productId: 'eggs-30', price: 9490, available: true },
  { martId: 'coupang', productId: 'eggs-30', price: 8790, available: true },

  { martId: 'emart', productId: 'rice-10kg', price: 32900, available: true },
  { martId: 'homeplus', productId: 'rice-10kg', price: 33900, available: true },
  { martId: 'coupang', productId: 'rice-10kg', price: 34500, available: false },

  { martId: 'emart', productId: 'tissue-30', price: 15900, available: true },
  { martId: 'homeplus', productId: 'tissue-30', price: 14900, available: true },
  { martId: 'coupang', productId: 'tissue-30', price: 13990, available: true },

  { martId: 'emart', productId: 'pork-500g', price: 12980, available: true },
  { martId: 'homeplus', productId: 'pork-500g', price: 11990, available: true },
  { martId: 'coupang', productId: 'pork-500g', price: 13500, available: true },

  { martId: 'emart', productId: 'tofu-2', price: 3480, available: true },
  { martId: 'homeplus', productId: 'tofu-2', price: 3280, available: true },
  { martId: 'coupang', productId: 'tofu-2', price: 3590, available: true },

  { martId: 'emart', productId: 'banana-1kg', price: 3980, available: true },
  { martId: 'homeplus', productId: 'banana-1kg', price: 4290, available: false },
  { martId: 'coupang', productId: 'banana-1kg', price: 3780, available: true },

  { martId: 'emart', productId: 'ramen-5', price: 4380, available: true },
  { martId: 'homeplus', productId: 'ramen-5', price: 4180, available: true },
  { martId: 'coupang', productId: 'ramen-5', price: 4250, available: true },

  { martId: 'emart', productId: 'yogurt-4', price: 5480, available: true },
  { martId: 'homeplus', productId: 'yogurt-4', price: 5980, available: true },
  { martId: 'coupang', productId: 'yogurt-4', price: 5290, available: true },

  { martId: 'emart', productId: 'detergent-3l', price: 11900, available: true },
  { martId: 'homeplus', productId: 'detergent-3l', price: 10900, available: true },
  { martId: 'coupang', productId: 'detergent-3l', price: 12500, available: true },
];

export const FIXTURE_COUPONS: Coupon[] = [
  {
    id: 'emart-10pct',
    martId: 'emart',
    name: '쓱배송 10% (최대 5천원)',
    type: 'percent',
    value: 10,
    minOrder: 50000,
    maxDiscount: 5000,
  },
  {
    id: 'homeplus-3000',
    martId: 'homeplus',
    name: '홈플러스 3,000원 할인',
    type: 'fixed',
    value: 3000,
    minOrder: 30000,
  },
  {
    id: 'coupang-2000',
    martId: 'coupang',
    name: '로켓프레시 2,000원 할인',
    type: 'fixed',
    value: 2000,
    minOrder: 25000,
  },
];

export const FIXTURE_SLOTS: DeliverySlot[] = [
  { martId: 'emart', date: '2026-07-05', timeRange: '08:00~11:00', available: false },
  { martId: 'emart', date: '2026-07-05', timeRange: '14:00~17:00', available: true },
  { martId: 'homeplus', date: '2026-07-05', timeRange: '10:00~13:00', available: true },
  { martId: 'coupang', date: '2026-07-05', timeRange: '새벽배송 (07:00 전)', available: true },
];
