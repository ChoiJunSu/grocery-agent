import type { Mart, Product } from './types.js';

/**
 * 연동 대상 마트의 기준 설정과 내부 상품 카탈로그.
 *
 * 가격·쿠폰·배송슬롯은 여기에 두지 않는다 — 전부 익스텐션이 로그인 세션에서
 * 수집한 실데이터만 사용한다. 이 파일은 "어떤 마트를 어떤 조건으로 다루는가"와
 * "우리가 비교 단위로 삼는 상품이 무엇인가"만 정의한다.
 *
 * 배송비/무료배송 기준은 마트 정책이라 바뀔 수 있다. 실제 결제 금액과 어긋나면
 * 여기 값을 고쳐야 한다.
 */

export const MARTS: Mart[] = [
  {
    id: 'emart',
    name: '이마트 쓱배송',
    shippingFee: 3000,
    freeShippingThreshold: 40000,
    cartUrl: 'https://pay.ssg.com/cart/dmsShpp.ssg',
  },
  {
    id: 'homeplus',
    name: '홈플러스',
    shippingFee: 3000,
    freeShippingThreshold: 30000,
    cartUrl: 'https://front.homeplus.co.kr/cart',
  },
  {
    id: 'coupang',
    name: '쿠팡 로켓프레시',
    shippingFee: 3000,
    freeShippingThreshold: 15000,
    cartUrl: 'https://cart.coupang.com/cartView.pang',
  },
  {
    id: 'kurly',
    name: '마켓컬리',
    shippingFee: 3000,
    freeShippingThreshold: 40000,
    cartUrl: 'https://www.kurly.com/cart',
  },
];

/** 마트 간 가격 비교의 단위가 되는 내부 상품. 사이트 상품명은 matching.ts가 여기에 매핑한다. */
export const PRODUCTS: Product[] = [
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
