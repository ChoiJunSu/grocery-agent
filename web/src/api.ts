import type { CartItem, Mart, OptimizePlan, Product } from '@grocery/core';

const SERVER = 'http://localhost:3001';

export interface StoredPlan {
  id: string;
  createdAt: string;
  plan: OptimizePlan;
  dataSources: Record<string, 'mock' | 'live'>;
  execution: 'idle' | 'queued' | 'running' | 'done' | 'failed';
  actions?: {
    id: string;
    martId: string;
    status: 'pending' | 'claimed' | 'done' | 'failed';
    detail?: string;
  }[];
}

export interface IngestStatus {
  marts: {
    martId: string;
    name: string;
    source: 'mock' | 'live';
    ingestedAt: string | null;
    offerCount: number | null;
  }[];
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  catalog: () =>
    request<{ products: Product[]; marts: Pick<Mart, 'id' | 'name' | 'shippingFee' | 'freeShippingThreshold'>[] }>(
      '/api/catalog',
    ),
  ingestStatus: () => request<IngestStatus>('/api/ingest/status'),
  optimize: (items: CartItem[]) =>
    request<StoredPlan>('/api/optimize', { method: 'POST', body: JSON.stringify({ items }) }),
  execute: (planId: string) =>
    request<{ ok: boolean }>('/api/execute', { method: 'POST', body: JSON.stringify({ planId }) }),
  plan: (id: string) => request<StoredPlan>(`/api/plan/${id}`),
};

export const krw = (n: number) => `${n.toLocaleString('ko-KR')}원`;
