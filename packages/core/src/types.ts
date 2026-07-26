/** 사용자가 사려는 품목 (마트 미정 상태) */
export interface CartItem {
  productId: string;
  quantity: number;
}

export interface Product {
  id: string;
  name: string;
  unit: string; // "1L", "30구" 등 표시용
}

export interface Mart {
  id: string;
  name: string;
  shippingFee: number; // 무료배송 기준 미달 시 배송비 (KRW)
  freeShippingThreshold: number; // 이 금액 이상이면 배송비 0 (KRW)
  cartUrl: string; // 익스텐션이 장바구니 담기 시 열어야 하는 페이지
}

/** 특정 마트의 특정 상품 판매 정보 (익스텐션이 로그인 세션에서 스크랩) */
export interface Offer {
  martId: string;
  productId: string;
  price: number; // 단가 (KRW)
  available: boolean;
}

export interface Coupon {
  id: string;
  martId: string;
  name: string;
  type: 'percent' | 'fixed';
  value: number; // percent면 %, fixed면 KRW
  minOrder: number; // 최소 주문 금액 (상품 소계 기준)
  maxDiscount?: number; // percent 쿠폰의 최대 할인 한도
}

export interface DeliverySlot {
  martId: string;
  date: string; // YYYY-MM-DD
  timeRange: string; // "14:00~17:00"
  available: boolean;
}

export interface OptimizeInput {
  items: CartItem[];
  products: Product[];
  marts: Mart[];
  offers: Offer[];
  coupons: Coupon[];
  slots: DeliverySlot[];
}

export interface BasketLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface AppliedCoupon {
  couponId: string;
  name: string;
  discount: number;
}

export interface MartBasket {
  martId: string;
  martName: string;
  lines: BasketLine[];
  subtotal: number;
  shippingFee: number;
  coupon: AppliedCoupon | null;
  total: number; // subtotal + shippingFee - discount
  slot: DeliverySlot | null; // 가장 빠른 예약 가능 슬롯
}

export interface UnassignedItem {
  productId: string;
  name: string;
  reason: string;
}

/** 단일 마트에 전량 구매했을 때의 비교 기준 */
export interface Baseline {
  martId: string;
  martName: string;
  total: number | null; // 해당 마트에서 전 품목 구매 불가 시 null
}

export interface OptimizePlan {
  baskets: MartBasket[];
  grandTotal: number;
  unassigned: UnassignedItem[];
  baselines: Baseline[];
  /** 가장 저렴한 단일 마트 대비 절약액. 비교 불가 시 null */
  savings: number | null;
  strategy: 'exhaustive' | 'greedy';
}
