import Fastify from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import {
  matchProduct,
  MOCK_COUPONS,
  MOCK_MARTS,
  MOCK_OFFERS,
  MOCK_PRODUCTS,
  MOCK_SLOTS,
  optimize,
  PRODUCT_ALIASES,
  type CartItem,
  type Coupon,
  type DeliverySlot,
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
 * 최적화 입력 조립: 기본은 mock, 익스텐션이 ingest한 마트는 live 데이터로 덮어쓴다.
 */
function buildOptimizeInput(
  token: string,
  items: CartItem[],
): {
  input: OptimizeInput;
  dataSources: Record<string, 'mock' | 'live'>;
} {
  const offers: Offer[] = [];
  const coupons: Coupon[] = [];
  const slots: DeliverySlot[] = [];
  const dataSources: Record<string, 'mock' | 'live'> = {};

  for (const mart of MOCK_MARTS) {
    const live = store.getIngested(token, mart.id);
    if (live) {
      offers.push(...live.offers);
      coupons.push(...live.coupons);
      slots.push(...live.slots);
      dataSources[mart.id] = 'live';
    } else {
      offers.push(...MOCK_OFFERS.filter((o) => o.martId === mart.id));
      coupons.push(...MOCK_COUPONS.filter((c) => c.martId === mart.id));
      slots.push(...MOCK_SLOTS.filter((s) => s.martId === mart.id));
      dataSources[mart.id] = 'mock';
    }
  }

  return {
    input: { items, products: MOCK_PRODUCTS, marts: MOCK_MARTS, offers, coupons, slots },
    dataSources,
  };
}

app.get('/api/health', async () => ({ ok: true, now: new Date().toISOString() }));

/** 웹 UI가 장보기 목록을 만들 때 쓰는 카탈로그 */
app.get('/api/catalog', async () => ({
  products: MOCK_PRODUCTS,
  marts: MOCK_MARTS.map(({ id, name, shippingFee, freeShippingThreshold }) => ({
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
  if (!martId || !MOCK_MARTS.some((m) => m.id === martId)) {
    return reply.code(400).send({ error: `unknown martId: ${martId}` });
  }

  const catalogIds = new Set(MOCK_PRODUCTS.map((p) => p.id));
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
    const match = matchProduct(siteName, MOCK_PRODUCTS, PRODUCT_ALIASES[martId]);
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
  marts: MOCK_MARTS.map((m) => {
    const live = store.getIngested(req.userToken, m.id);
    return {
      martId: m.id,
      name: m.name,
      source: live ? 'live' : 'mock',
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

  const { input, dataSources } = buildOptimizeInput(req.userToken, items);
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
    cartUrl: MOCK_MARTS.find((m) => m.id === basket.martId)!.cartUrl,
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
