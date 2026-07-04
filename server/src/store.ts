import type { Coupon, DeliverySlot, Offer, OptimizePlan } from '@grocery/core';

/** 익스텐션이 마트 페이지에서 수집해 보낸 스냅샷 (마트 단위) */
export interface IngestedMartData {
  offers: Offer[];
  coupons: Coupon[];
  slots: DeliverySlot[];
  ingestedAt: string;
}

export interface StoredPlan {
  id: string;
  createdAt: string;
  plan: OptimizePlan;
  /** 마트별 mock/live 데이터 출처 */
  dataSources: Record<string, 'mock' | 'live'>;
  execution: 'idle' | 'queued' | 'running' | 'done' | 'failed';
}

export interface CartAction {
  id: string;
  planId: string;
  martId: string;
  cartUrl: string;
  items: { productId: string; name: string; quantity: number }[];
  status: 'pending' | 'claimed' | 'done' | 'failed';
  detail?: string;
  createdAt: string;
}

/** MVP: 단일 사용자 in-memory 저장소. 서버 재시작 시 초기화된다. */
export const store = {
  ingested: new Map<string, IngestedMartData>(),
  plans: new Map<string, StoredPlan>(),
  actions: [] as CartAction[],
};

export function refreshPlanExecution(plan: StoredPlan): void {
  const actions = store.actions.filter((a) => a.planId === plan.id);
  if (actions.length === 0) return;
  if (actions.every((a) => a.status === 'done')) plan.execution = 'done';
  else if (actions.some((a) => a.status === 'failed')) plan.execution = 'failed';
  else if (actions.some((a) => a.status === 'claimed')) plan.execution = 'running';
  else plan.execution = 'queued';
}
