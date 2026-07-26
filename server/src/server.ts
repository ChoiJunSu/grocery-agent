import Fastify from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import {
  MARTS,
  matchProduct,
  optimize,
  PRODUCT_ALIASES,
  PRODUCTS,
  type CartItem,
  type Coupon,
  type DeliverySlot,
  type Mart,
  type Offer,
  type OptimizeInput,
} from '@grocery/core';
import { refreshPlanExecution, store, type CartAction, type StoredPlan } from './store.js';

const PORT = Number(process.env.PORT ?? 3001);

const app = Fastify({ logger: true });
await app.register(cors, { origin: true }); // MVP: 웹 UI(5173)와 익스텐션 모두 허용

declare module 'fastify' {
  interface FastifyRequest {
    userToken: string;
  }
}

/** /api/health를 제외한 모든 요청은 X-User-Token 필수. 처음 보는 토큰은 사용자로 자동 등록. */
app.addHook('onRequest', async (req, reply) => {
  if (req.method === 'OPTIONS' || req.url === '/api/health') return;
  const token = req.headers['x-user-token'];
  if (typeof token !== 'string' || token.length < 8) {
    return reply.code(401).send({ error: 'X-User-Token 헤더가 필요합니다 (8자 이상)' });
  }
  store.ensureUser(token);
  req.userToken = token;
});

/**
 * 최적화 입력 조립: 익스텐션이 수집한 실데이터만 사용한다.
 *
 * 수집 이력이 없는 마트는 가격을 지어내지 않고 비교 대상에서 아예 제외한다.
 * 없는 데이터를 채워 넣으면 "이 마트가 더 싸다"는 틀린 결론이 나오기 때문이다.
 */
function buildOptimizeInput(
  token: string,
  items: CartItem[],
): {
  input: OptimizeInput;
  dataSources: Record<string, 'live' | 'none'>;
  collectedMarts: Mart[];
} {
  const offers: Offer[] = [];
  const coupons: Coupon[] = [];
  const slots: DeliverySlot[] = [];
  const dataSources: Record<string, 'live' | 'none'> = {};
  const collectedMarts: Mart[] = [];

  for (const mart of MARTS) {
    const live = store.getIngested(token, mart.id);
    if (!live || live.offers.length === 0) {
      dataSources[mart.id] = 'none';
      continue;
    }
    offers.push(...live.offers);
    coupons.push(...live.coupons);
    slots.push(...live.slots);
    dataSources[mart.id] = 'live';
    collectedMarts.push(mart);
  }

  return {
    input: { items, products: PRODUCTS, marts: collectedMarts, offers, coupons, slots },
    dataSources,
    collectedMarts,
  };
}

app.get('/api/health', async () => ({ ok: true, now: new Date().toISOString() }));

/** 웹 UI가 장보기 목록을 만들 때 쓰는 카탈로그 */
app.get('/api/catalog', async () => ({
  products: PRODUCTS,
  marts: MARTS.map(({ id, name, shippingFee, freeShippingThreshold }) => ({
    id,
    name,
    shippingFee,
    freeShippingThreshold,
  })),
}));

/** 익스텐션이 수집한 offer. productId 확정본이거나, siteName만 있는 원시 스크랩본. */
interface RawOffer {
  productId?: string;
  siteName?: string;
  price: number;
  available: boolean;
}

/** 익스텐션이 마트 페이지에서 수집한 데이터를 밀어넣는 엔드포인트 */
app.post<{
  Body: { martId: string; offers?: RawOffer[]; coupons?: Coupon[]; slots?: DeliverySlot[] };
}>('/api/ingest', async (req, reply) => {
  const { martId, offers = [], coupons = [], slots = [] } = req.body ?? {};
  if (!martId || !MARTS.some((m) => m.id === martId)) {
    return reply.code(400).send({ error: `unknown martId: ${martId}` });
  }

  const catalogIds = new Set(PRODUCTS.map((p) => p.id));
  const matched: Offer[] = [];
  const unmatched: { siteName: string; price: number }[] = [];

  for (const raw of offers) {
    if (typeof raw.price !== 'number' || raw.price <= 0) continue;
    if (raw.productId && catalogIds.has(raw.productId)) {
      matched.push({ martId, productId: raw.productId, price: raw.price, available: raw.available !== false });
      continue;
    }
    const siteName = raw.siteName ?? raw.productId;
    if (!siteName) continue;
    const match = matchProduct(siteName, PRODUCTS, PRODUCT_ALIASES[martId]);
    if (match) {
      matched.push({ martId, productId: match.productId, price: raw.price, available: raw.available !== false });
    } else {
      unmatched.push({ siteName, price: raw.price });
    }
  }

  // 같은 상품이 여러 카드로 잡히면 최저가만 남긴다
  const cheapest = new Map<string, Offer>();
  for (const o of matched) {
    const prev = cheapest.get(o.productId);
    if (!prev || o.price < prev.price) cheapest.set(o.productId, o);
  }

  store.saveIngested(req.userToken, martId, {
    offers: [...cheapest.values()],
    coupons: coupons.map((c) => ({ ...c, martId })),
    slots: slots.map((s) => ({ ...s, martId })),
  });
  if (unmatched.length > 0) store.saveUnmatched(req.userToken, martId, unmatched);

  return {
    ok: true,
    martId,
    matchedCount: cheapest.size,
    unmatchedCount: unmatched.length,
    unmatched: unmatched.map((u) => u.siteName),
    couponCount: coupons.length,
  };
});

/** 마트별 수집 데이터 현황 (웹 UI 상단 상태 표시용) */
app.get('/api/ingest/status', async (req) => ({
  marts: MARTS.map((m) => {
    const live = store.getIngested(req.userToken, m.id);
    return {
      martId: m.id,
      name: m.name,
      source: live && live.offers.length > 0 ? 'live' : 'none',
      ingestedAt: live?.ingestedAt ?? null,
      offerCount: live?.offers.length ?? null,
    };
  }),
  unmatched: store.getUnmatched(req.userToken),
}));

/** 핵심: 장보기 목록을 받아 마트별 최적 분할 계획을 계산 */
app.post<{ Body: { items: CartItem[] } }>('/api/optimize', async (req, reply) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return reply.code(400).send({ error: 'items is required' });
  }
  for (const item of items) {
    if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1) {
      return reply.code(400).send({ error: `invalid item: ${JSON.stringify(item)}` });
    }
  }

  const { input, dataSources, collectedMarts } = buildOptimizeInput(req.userToken, items);
  if (collectedMarts.length === 0) {
    return reply.code(409).send({
      error:
        '수집된 마트 데이터가 없습니다. 마트에 로그인한 탭을 열고 익스텐션 팝업에서 "가격 · 쿠폰 지금 동기화"를 먼저 실행하세요.',
      dataSources,
    });
  }
  const plan = optimize(input);
  const stored: StoredPlan = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    plan,
    dataSources,
    execution: 'idle',
  };
  store.savePlan(req.userToken, stored);
  return stored;
});

app.get<{ Params: { id: string } }>('/api/plan/:id', async (req, reply) => {
  const stored = store.getPlan(req.userToken, req.params.id);
  if (!stored) return reply.code(404).send({ error: 'plan not found' });
  refreshPlanExecution(stored);
  return { ...stored, actions: store.getActionsByPlan(stored.id) };
});

/** 웹 UI에서 "장바구니 담기 실행" → 마트별 CartAction을 큐에 등록 */
app.post<{ Body: { planId: string } }>('/api/execute', async (req, reply) => {
  const stored = req.body?.planId ? store.getPlan(req.userToken, req.body.planId) : null;
  if (!stored) return reply.code(404).send({ error: 'plan not found' });
  refreshPlanExecution(stored);
  if (stored.execution === 'queued' || stored.execution === 'running') {
    return reply.code(409).send({ error: 'already executing' });
  }

  const actions: CartAction[] = stored.plan.baskets.map((basket) => ({
    id: randomUUID(),
    planId: stored.id,
    martId: basket.martId,
    cartUrl: MARTS.find((m) => m.id === basket.martId)!.cartUrl,
    items: basket.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity })),
    status: 'pending',
    verified: false,
    createdAt: new Date().toISOString(),
  }));
  store.saveActions(req.userToken, actions);
  store.setPlanExecution(stored.id, 'queued');
  return { ok: true, planId: stored.id, actionCount: actions.length };
});

/** 익스텐션 background가 폴링: 대기 중인 장바구니 담기 작업을 가져가며 claimed로 전환 */
app.post('/api/actions/claim', async (req) => ({
  actions: store.claimPendingActions(req.userToken),
}));

/** 익스텐션이 마트별 담기 결과를 보고. verified = 장바구니 페이지 재확인 통과 여부 */
app.post<{ Body: { actionId: string; status: 'done' | 'failed'; verified?: boolean; detail?: string } }>(
  '/api/actions/result',
  async (req, reply) => {
    const { actionId, status, verified = false, detail } = req.body ?? {};
    const action = actionId ? store.getAction(req.userToken, actionId) : null;
    if (!action) return reply.code(404).send({ error: 'action not found' });
    if (status !== 'done' && status !== 'failed') {
      return reply.code(400).send({ error: 'status must be done|failed' });
    }
    store.setActionResult(actionId, status, verified, detail);
    const plan = store.getPlan(req.userToken, action.planId);
    if (plan) refreshPlanExecution(plan);
    return { ok: true };
  },
);

await app.listen({ port: PORT, host: '0.0.0.0' });
