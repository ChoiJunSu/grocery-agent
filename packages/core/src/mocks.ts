import type { Coupon, DeliverySlot, Mart, Offer, Product } from './types.js';

/**
 * 실제 마트 데이터가 익스텐션으로 수집되기 전까지 전체 사이클을 돌리기 위한 mock.
 * 익스텐션이 /api/ingest로 실데이터를 보내면 서버가 마트 단위로 이 값을 덮어쓴다.
 */

export const MOCK_MARTS: Mart[] = [
  {
    id: 'emart',
    name: '이마트 쓱배송',
    shippingFee: 3000,
    freeShippingThreshold: 40000,
    cartUrl: 'https://emart.ssg.com/',
  },
  {
    id: 'homeplus',
    name: '홈플러스',
    shippingFee: 3000,
    freeShippingThreshold: 30000,
    cartUrl: 'https://front.homeplus.co.kr/',
  },
  {
    id: 'coupang',
    name: '쿠팡 로켓프레시',
    shippingFee: 3000,
    freeShippingThreshold: 15000,
    cartUrl: 'https://www.coupang.com/',
  },
];

export const MOCK_PRODUCTS: Product[] = [
  { id: 'milk-1l', name: '서울우유 1L', unit: '1L' },
  { id: 'eggs-30', name: '무항생제 계란 30구', unit: '30구' },
  { id: 'rice-10kg', name: '햅쌀 10kg', unit: '10kg' },
  { id: 'tissue-30', name: '3겹 화장지 30롤', unit: '30롤' },
  { id: 'pork-500g', name: '삼겹살 500g', unit: '500g' },
  { id: 'tofu-2', name: '국산콩 두부 2입', unit: '2입' },
  { id: 'banana-1kg', name: '바나나 1kg', unit: '1kg' },
  { id: 'ramen-5', name: '신라면 5입', unit: '5입' },
  { id: 'yogurt-4', name: '그릭요거트 4입', unit: '4입' },
  { id: 'detergent-3l', name: '액체세제 3L', unit: '3L' },
];

export const MOCK_OFFERS: Offer[] = [
  // milk
  { martId: 'emart', productId: 'milk-1l', price: 2980, available: true },
  { martId: 'homeplus', productId: 'milk-1l', price: 2890, available: true },
  { martId: 'coupang', productId: 'milk-1l', price: 3050, available: true },
  // eggs
  { martId: 'emart', productId: 'eggs-30', price: 8980, available: true },
  { martId: 'homeplus', productId: 'eggs-30', price: 9490, available: true },
  { martId: 'coupang', productId: 'eggs-30', price: 8790, available: true },
  // rice
  { martId: 'emart', productId: 'rice-10kg', price: 32900, available: true },
  { martId: 'homeplus', productId: 'rice-10kg', price: 33900, available: true },
  { martId: 'coupang', productId: 'rice-10kg', price: 34500, available: false },
  // tissue
  { martId: 'emart', productId: 'tissue-30', price: 15900, available: true },
  { martId: 'homeplus', productId: 'tissue-30', price: 14900, available: true },
  { martId: 'coupang', productId: 'tissue-30', price: 13990, available: true },
  // pork
  { martId: 'emart', productId: 'pork-500g', price: 12980, available: true },
  { martId: 'homeplus', productId: 'pork-500g', price: 11990, available: true },
  { martId: 'coupang', productId: 'pork-500g', price: 13500, available: true },
  // tofu
  { martId: 'emart', productId: 'tofu-2', price: 3480, available: true },
  { martId: 'homeplus', productId: 'tofu-2', price: 3280, available: true },
  { martId: 'coupang', productId: 'tofu-2', price: 3590, available: true },
  // banana
  { martId: 'emart', productId: 'banana-1kg', price: 3980, available: true },
  { martId: 'homeplus', productId: 'banana-1kg', price: 4290, available: false },
  { martId: 'coupang', productId: 'banana-1kg', price: 3780, available: true },
  // ramen
  { martId: 'emart', productId: 'ramen-5', price: 4380, available: true },
  { martId: 'homeplus', productId: 'ramen-5', price: 4180, available: true },
  { martId: 'coupang', productId: 'ramen-5', price: 4250, available: true },
  // yogurt
  { martId: 'emart', productId: 'yogurt-4', price: 5480, available: true },
  { martId: 'homeplus', productId: 'yogurt-4', price: 5980, available: true },
  { martId: 'coupang', productId: 'yogurt-4', price: 5290, available: true },
  // detergent
  { martId: 'emart', productId: 'detergent-3l', price: 11900, available: true },
  { martId: 'homeplus', productId: 'detergent-3l', price: 10900, available: true },
  { martId: 'coupang', productId: 'detergent-3l', price: 12500, available: true },
];

export const MOCK_COUPONS: Coupon[] = [
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

export const MOCK_SLOTS: DeliverySlot[] = [
  { martId: 'emart', date: '2026-07-05', timeRange: '08:00~11:00', available: false },
  { martId: 'emart', date: '2026-07-05', timeRange: '14:00~17:00', available: true },
  { martId: 'homeplus', date: '2026-07-05', timeRange: '10:00~13:00', available: true },
  { martId: 'coupang', date: '2026-07-05', timeRange: '새벽배송 (07:00 전)', available: true },
];
