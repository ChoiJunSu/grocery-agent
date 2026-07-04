import type {
  AppliedCoupon,
  Baseline,
  CartItem,
  Coupon,
  DeliverySlot,
  Mart,
  MartBasket,
  Offer,
  OptimizeInput,
  OptimizePlan,
  Product,
  UnassignedItem,
} from './types.js';

/** 전수 탐색을 허용하는 최대 조합 수. 초과하면 greedy로 전환. */
const EXHAUSTIVE_LIMIT = 300_000;

interface ItemCandidate {
  item: CartItem;
  product: Product;
  /** martId -> 단가. 판매 중인 마트만 포함. */
  prices: Map<string, number>;
  candidateMartIds: string[];
}

/**
 * 품목별 마트 배정을 최적화한다.
 * 목적함수: sum(마트별 소계 + 배송비 - 최적 쿠폰 할인) 최소화.
 * 조합 수가 작으면 전수 탐색으로 전역 최적해, 크면 greedy + 지역 개선.
 */
export function optimize(input: OptimizeInput): OptimizePlan {
  const productById = new Map(input.products.map((p) => [p.id, p]));
  const martById = new Map(input.marts.map((m) => [m.id, m]));

  const couponsByMart = new Map<string, Coupon[]>();
  for (const c of input.coupons) {
    if (!couponsByMart.has(c.martId)) couponsByMart.set(c.martId, []);
    couponsByMart.get(c.martId)!.push(c);
  }

  const offerKey = (martId: string, productId: string) => `${martId}:${productId}`;
  const offerMap = new Map(input.offers.map((o) => [offerKey(o.martId, o.productId), o]));

  const unassigned: UnassignedItem[] = [];
  const candidates: ItemCandidate[] = [];

  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) {
      unassigned.push({ productId: item.productId, name: item.productId, reason: '카탈로그에 없는 상품' });
      continue;
    }
    const prices = new Map<string, number>();
    for (const mart of input.marts) {
      const offer = offerMap.get(offerKey(mart.id, item.productId));
      if (offer && offer.available) prices.set(mart.id, offer.price);
    }
    if (prices.size === 0) {
      unassigned.push({ productId: item.productId, name: product.name, reason: '모든 마트에서 품절/미취급' });
      continue;
    }
    candidates.push({ item, product, prices, candidateMartIds: [...prices.keys()] });
  }

  const evaluate = (assignment: string[]): { baskets: MartBasket[]; grandTotal: number } =>
    evaluateAssignment(assignment, candidates, martById, couponsByMart, input.slots);

  let bestAssignment: string[];
  let strategy: OptimizePlan['strategy'];

  const combinations = candidates.reduce((acc, c) => acc * c.candidateMartIds.length, 1);
  if (candidates.length === 0) {
    bestAssignment = [];
    strategy = 'exhaustive';
  } else if (combinations <= EXHAUSTIVE_LIMIT) {
    bestAssignment = exhaustiveSearch(candidates, evaluate);
    strategy = 'exhaustive';
  } else {
    bestAssignment = greedySearch(candidates, evaluate);
    strategy = 'greedy';
  }

  const { baskets, grandTotal } = evaluate(bestAssignment);
  const baselines = computeBaselines(candidates, input.marts, couponsByMart, input.slots);
  const feasibleBaselines = baselines.filter((b) => b.total !== null).map((b) => b.total!);
  const savings = feasibleBaselines.length > 0 ? Math.min(...feasibleBaselines) - grandTotal : null;

  return { baskets, grandTotal, unassigned, baselines, savings, strategy };
}

function exhaustiveSearch(
  candidates: ItemCandidate[],
  evaluate: (assignment: string[]) => { grandTotal: number },
): string[] {
  let best: string[] = [];
  let bestTotal = Infinity;
  const assignment: string[] = new Array(candidates.length);

  const recurse = (idx: number) => {
    if (idx === candidates.length) {
      const { grandTotal } = evaluate(assignment);
      if (grandTotal < bestTotal) {
        bestTotal = grandTotal;
        best = [...assignment];
      }
      return;
    }
    for (const martId of candidates[idx].candidateMartIds) {
      assignment[idx] = martId;
      recurse(idx + 1);
    }
  };
  recurse(0);
  return best;
}

/** 품목별 최저가 마트로 시작 → 한 품목씩 옮겨보며 총액이 줄면 채택, 개선 없을 때까지 반복. */
function greedySearch(
  candidates: ItemCandidate[],
  evaluate: (assignment: string[]) => { grandTotal: number },
): string[] {
  const assignment = candidates.map((c) => {
    let bestMart = c.candidateMartIds[0];
    for (const martId of c.candidateMartIds) {
      if (c.prices.get(martId)! < c.prices.get(bestMart)!) bestMart = martId;
    }
    return bestMart;
  });

  let currentTotal = evaluate(assignment).grandTotal;
  for (let pass = 0; pass < 100; pass++) {
    let improved = false;
    for (let i = 0; i < candidates.length; i++) {
      const original = assignment[i];
      for (const martId of candidates[i].candidateMartIds) {
        if (martId === original) continue;
        assignment[i] = martId;
        const { grandTotal } = evaluate(assignment);
        if (grandTotal < currentTotal) {
          currentTotal = grandTotal;
          improved = true;
        } else {
          assignment[i] = original;
        }
      }
    }
    if (!improved) break;
  }
  return assignment;
}

function evaluateAssignment(
  assignment: string[],
  candidates: ItemCandidate[],
  martById: Map<string, Mart>,
  couponsByMart: Map<string, Coupon[]>,
  slots: DeliverySlot[],
): { baskets: MartBasket[]; grandTotal: number } {
  const byMart = new Map<string, ItemCandidate[]>();
  assignment.forEach((martId, i) => {
    if (!byMart.has(martId)) byMart.set(martId, []);
    byMart.get(martId)!.push(candidates[i]);
  });

  const baskets: MartBasket[] = [];
  let grandTotal = 0;
  for (const [martId, members] of byMart) {
    const mart = martById.get(martId)!;
    const basket = buildBasket(mart, members, couponsByMart.get(martId) ?? [], slots);
    baskets.push(basket);
    grandTotal += basket.total;
  }
  baskets.sort((a, b) => b.subtotal - a.subtotal);
  return { baskets, grandTotal };
}

function buildBasket(
  mart: Mart,
  members: ItemCandidate[],
  coupons: Coupon[],
  slots: DeliverySlot[],
): MartBasket {
  const lines = members.map((c) => {
    const unitPrice = c.prices.get(mart.id)!;
    return {
      productId: c.product.id,
      name: c.product.name,
      quantity: c.item.quantity,
      unitPrice,
      lineTotal: unitPrice * c.item.quantity,
    };
  });
  const subtotal = lines.reduce((acc, l) => acc + l.lineTotal, 0);
  const shippingFee = subtotal >= mart.freeShippingThreshold ? 0 : mart.shippingFee;
  const coupon = pickBestCoupon(coupons, subtotal);
  const total = subtotal + shippingFee - (coupon?.discount ?? 0);
  const slot =
    slots.find((s) => s.martId === mart.id && s.available) ?? null;
  return { martId: mart.id, martName: mart.name, lines, subtotal, shippingFee, coupon, total, slot };
}

/** 소계가 minOrder를 넘는 쿠폰 중 할인액이 가장 큰 하나를 적용 (마트당 1장 가정). */
export function pickBestCoupon(coupons: Coupon[], subtotal: number): AppliedCoupon | null {
  let best: AppliedCoupon | null = null;
  for (const c of coupons) {
    if (subtotal < c.minOrder) continue;
    let discount =
      c.type === 'percent' ? Math.floor((subtotal * c.value) / 100) : c.value;
    if (c.type === 'percent' && c.maxDiscount !== undefined) {
      discount = Math.min(discount, c.maxDiscount);
    }
    discount = Math.min(discount, subtotal);
    if (!best || discount > best.discount) {
      best = { couponId: c.id, name: c.name, discount };
    }
  }
  return best;
}

function computeBaselines(
  candidates: ItemCandidate[],
  marts: Mart[],
  couponsByMart: Map<string, Coupon[]>,
  slots: DeliverySlot[],
): Baseline[] {
  return marts.map((mart) => {
    const allAvailable = candidates.every((c) => c.prices.has(mart.id));
    if (!allAvailable || candidates.length === 0) {
      return { martId: mart.id, martName: mart.name, total: null };
    }
    const basket = buildBasket(mart, candidates, couponsByMart.get(mart.id) ?? [], slots);
    return { martId: mart.id, martName: mart.name, total: basket.total };
  });
}
