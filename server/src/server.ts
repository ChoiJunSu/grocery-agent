import Fastify from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import {
  MOCK_COUPONS,
  MOCK_MARTS,
  MOCK_OFFERS,
  MOCK_PRODUCTS,
  MOCK_SLOTS,
  optimize,
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

/**
 * 최적화 입력 조립: 기본은 mock, 익스텐션이 ingest한 마트는 live 데이터로 덮어쓴다.
 */
function buildOptimizeInput(items: CartItem[]): {
  input: OptimizeInput;
  dataSources: Record<string, 'mock' | 'live'>;
} {
  const offers: Offer[] = [];
  const coupons: Coupon[] = [];
  const slots: DeliverySlot[] = [];
  const dataSources: Record<string, 'mock' | 'live'> = {};

  for (const mart of MOCK_MARTS) {
    const live = store.ingested.get(mart.id);
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

/** 익스텐션이 마트 페이지에서 수집한 데이터를 밀어넣는 엔드포인트 */
app.post<{
  Body: { martId: string; offers?: Offer[]; coupons?: Coupon[]; slots?: DeliverySlot[] };
}>('/api/ingest', async (req, reply) => {
  const { martId, offers = [], coupons = [], slots = [] } = req.body ?? {};
  if (!martId || !MOCK_MARTS.some((m) => m.id === martId)) {
    return reply.code(400).send({ error: `unknown martId: ${martId}` });
  }
  store.ingested.set(martId, {
    offers: offers.map((o) => ({ ...o, martId })),
    coupons: coupons.map((c) => ({ ...c, martId })),
    slots: slots.map((s) => ({ ...s, martId })),
    ingestedAt: new Date().toISOString(),
  });
  return { ok: true, martId, offerCount: offers.length, couponCount: coupons.length };
});

/** 마트별 수집 데이터 현황 (웹 UI 상단 상태 표시용) */
app.get('/api/ingest/status', async () => ({
  marts: MOCK_MARTS.map((m) => {
    const live = store.ingested.get(m.id);
    return {
      martId: m.id,
      name: m.name,
      source: live ? 'live' : 'mock',
      ingestedAt: live?.ingestedAt ?? null,
      offerCount: live?.offers.length ?? null,
    };
  }),
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

  const { input, dataSources } = buildOptimizeInput(items);
  const plan = optimize(input);
  const stored: StoredPlan = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    plan,
    dataSources,
    execution: 'idle',
  };
  store.plans.set(stored.id, stored);
  return stored;
});

app.get<{ Params: { id: string } }>('/api/plan/:id', async (req, reply) => {
  const stored = store.plans.get(req.params.id);
  if (!stored) return reply.code(404).send({ error: 'plan not found' });
  refreshPlanExecution(stored);
  return {
    ...stored,
    actions: store.actions.filter((a) => a.planId === stored.id),
  };
});

/** 웹 UI에서 "장바구니 담기 실행" → 마트별 CartAction을 큐에 등록 */
app.post<{ Body: { planId: string } }>('/api/execute', async (req, reply) => {
  const stored = store.plans.get(req.body?.planId);
  if (!stored) return reply.code(404).send({ error: 'plan not found' });
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
    createdAt: new Date().toISOString(),
  }));
  store.actions.push(...actions);
  stored.execution = 'queued';
  return { ok: true, planId: stored.id, actionCount: actions.length };
});

/** 익스텐션 background가 폴링: 대기 중인 장바구니 담기 작업을 가져가며 claimed로 전환 */
app.post('/api/actions/claim', async () => {
  const pending = store.actions.filter((a) => a.status === 'pending');
  for (const a of pending) a.status = 'claimed';
  return { actions: pending };
});

/** 익스텐션이 마트별 담기 결과를 보고 */
app.post<{ Body: { actionId: string; status: 'done' | 'failed'; detail?: string } }>(
  '/api/actions/result',
  async (req, reply) => {
    const { actionId, status, detail } = req.body ?? {};
    const action = store.actions.find((a) => a.id === actionId);
    if (!action) return reply.code(404).send({ error: 'action not found' });
    if (status !== 'done' && status !== 'failed') {
      return reply.code(400).send({ error: 'status must be done|failed' });
    }
    action.status = status;
    action.detail = detail;
    const plan = store.plans.get(action.planId);
    if (plan) refreshPlanExecution(plan);
    return { ok: true };
  },
);

await app.listen({ port: PORT, host: '0.0.0.0' });
