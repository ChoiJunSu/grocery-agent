import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Coupon, DeliverySlot, Offer, OptimizePlan } from '@grocery/core';

/** 익스텐션이 마트 페이지에서 수집해 보낸 스냅샷 (마트 단위) */
export interface IngestedMartData {
  offers: Offer[];
  coupons: Coupon[];
  slots: DeliverySlot[];
  ingestedAt: string;
}

/** 카탈로그 매핑에 실패한 사이트 상품 (별칭 테이블 보강용) */
export interface UnmatchedOffer {
  martId: string;
  siteName: string;
  price: number;
  seenAt: string;
}

export interface StoredPlan {
  id: string;
  createdAt: string;
  plan: OptimizePlan;
  dataSources: Record<string, 'live' | 'none'>;
  execution: 'idle' | 'queued' | 'running' | 'done' | 'failed';
}

export interface CartAction {
  id: string;
  planId: string;
  martId: string;
  cartUrl: string;
  items: { productId: string; name: string; quantity: number }[];
  status: 'pending' | 'claimed' | 'done' | 'failed';
  /** 담기 후 장바구니 페이지 재확인 결과 */
  verified: boolean;
  detail?: string;
  createdAt: string;
}

const DB_PATH = process.env.GROCERY_DB ?? new URL('../data/grocery.db', import.meta.url).pathname;
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    token TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ingested (
    user_token TEXT NOT NULL,
    mart_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    ingested_at TEXT NOT NULL,
    PRIMARY KEY (user_token, mart_id)
  );
  CREATE TABLE IF NOT EXISTS unmatched (
    user_token TEXT NOT NULL,
    mart_id TEXT NOT NULL,
    site_name TEXT NOT NULL,
    price INTEGER NOT NULL,
    seen_at TEXT NOT NULL,
    PRIMARY KEY (user_token, mart_id, site_name)
  );
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    user_token TEXT NOT NULL,
    payload TEXT NOT NULL,
    data_sources TEXT NOT NULL,
    execution TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    user_token TEXT NOT NULL,
    mart_id TEXT NOT NULL,
    cart_url TEXT NOT NULL,
    items TEXT NOT NULL,
    status TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    detail TEXT,
    created_at TEXT NOT NULL
  );
`);

// 기존 DB 호환: 담기 시각 컬럼이 없으면 추가한다
const actionColumns = db.prepare('PRAGMA table_info(actions)').all() as unknown as { name: string }[];
if (!actionColumns.some((c) => c.name === 'claimed_at')) {
  db.exec('ALTER TABLE actions ADD COLUMN claimed_at TEXT');
}

/**
 * 익스텐션이 집어간 뒤 이 시간이 지나도록 결과 보고가 없으면 유실로 보고 회수한다.
 * MV3 서비스 워커는 담기 도중 크롬에 의해 종료될 수 있고, 그러면 결과 보고가 영영 오지 않는다.
 */
const STALE_CLAIM_MS = 3 * 60 * 1000;

const now = () => new Date().toISOString();

export const store = {
  ensureUser(token: string): void {
    db.prepare('INSERT OR IGNORE INTO users (token, created_at) VALUES (?, ?)').run(token, now());
  },

  // ---------- ingest ----------

  saveIngested(token: string, martId: string, data: Omit<IngestedMartData, 'ingestedAt'>): void {
    db.prepare(
      `INSERT INTO ingested (user_token, mart_id, payload, ingested_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_token, mart_id) DO UPDATE SET payload = excluded.payload, ingested_at = excluded.ingested_at`,
    ).run(token, martId, JSON.stringify(data), now());
  },

  getIngested(token: string, martId: string): IngestedMartData | null {
    const row = db
      .prepare('SELECT payload, ingested_at FROM ingested WHERE user_token = ? AND mart_id = ?')
      .get(token, martId) as unknown as { payload: string; ingested_at: string } | undefined;
    if (!row) return null;
    return { ...JSON.parse(row.payload), ingestedAt: row.ingested_at };
  },

  saveUnmatched(token: string, martId: string, items: { siteName: string; price: number }[]): void {
    const stmt = db.prepare(
      `INSERT INTO unmatched (user_token, mart_id, site_name, price, seen_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_token, mart_id, site_name) DO UPDATE SET price = excluded.price, seen_at = excluded.seen_at`,
    );
    for (const it of items) stmt.run(token, martId, it.siteName, it.price, now());
  },

  getUnmatched(token: string): UnmatchedOffer[] {
    const rows = db
      .prepare('SELECT mart_id, site_name, price, seen_at FROM unmatched WHERE user_token = ? ORDER BY seen_at DESC')
      .all(token) as unknown as { mart_id: string; site_name: string; price: number; seen_at: string }[];
    return rows.map((r) => ({ martId: r.mart_id, siteName: r.site_name, price: r.price, seenAt: r.seen_at }));
  },

  // ---------- plans ----------

  savePlan(token: string, plan: StoredPlan): void {
    db.prepare(
      'INSERT INTO plans (id, user_token, payload, data_sources, execution, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(plan.id, token, JSON.stringify(plan.plan), JSON.stringify(plan.dataSources), plan.execution, plan.createdAt);
  },

  getPlan(token: string, id: string): StoredPlan | null {
    const row = db
      .prepare('SELECT * FROM plans WHERE id = ? AND user_token = ?')
      .get(id, token) as
      | { id: string; payload: string; data_sources: string; execution: StoredPlan['execution']; created_at: string }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      createdAt: row.created_at,
      plan: JSON.parse(row.payload),
      dataSources: JSON.parse(row.data_sources),
      execution: row.execution,
    };
  },

  setPlanExecution(id: string, execution: StoredPlan['execution']): void {
    db.prepare('UPDATE plans SET execution = ? WHERE id = ?').run(execution, id);
  },

  // ---------- cart actions ----------

  saveActions(token: string, actions: CartAction[]): void {
    const stmt = db.prepare(
      `INSERT INTO actions (id, plan_id, user_token, mart_id, cart_url, items, status, verified, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const a of actions) {
      stmt.run(a.id, a.planId, token, a.martId, a.cartUrl, JSON.stringify(a.items), a.status, a.verified ? 1 : 0, a.detail ?? null, a.createdAt);
    }
  },

  getActionsByPlan(planId: string): CartAction[] {
    const rows = db.prepare('SELECT * FROM actions WHERE plan_id = ?').all(planId) as unknown as ActionRow[];
    return rows.map(rowToAction);
  },

  claimPendingActions(token: string): CartAction[] {
    // 보고 없이 유실된 작업 회수 (claimed_at이 비어 있으면 컬럼 추가 이전의 작업이므로 즉시 회수)
    db.prepare(
      `UPDATE actions SET status = 'pending', claimed_at = NULL
       WHERE user_token = ? AND status = 'claimed' AND (claimed_at IS NULL OR claimed_at < ?)`,
    ).run(token, new Date(Date.now() - STALE_CLAIM_MS).toISOString());

    const rows = db
      .prepare("SELECT * FROM actions WHERE user_token = ? AND status = 'pending'")
      .all(token) as unknown as ActionRow[];
    const claimedAt = now();
    const stmt = db.prepare("UPDATE actions SET status = 'claimed', claimed_at = ? WHERE id = ?");
    for (const r of rows) stmt.run(claimedAt, r.id);
    return rows.map((r) => ({ ...rowToAction(r), status: 'claimed' as const }));
  },

  getAction(token: string, actionId: string): CartAction | null {
    const row = db.prepare('SELECT * FROM actions WHERE id = ? AND user_token = ?').get(actionId, token) as unknown as
      | ActionRow
      | undefined;
    return row ? rowToAction(row) : null;
  },

  setActionResult(actionId: string, status: 'done' | 'failed', verified: boolean, detail?: string): void {
    db.prepare('UPDATE actions SET status = ?, verified = ?, detail = ? WHERE id = ?').run(
      status,
      verified ? 1 : 0,
      detail ?? null,
      actionId,
    );
  },
};

interface ActionRow {
  id: string;
  plan_id: string;
  mart_id: string;
  cart_url: string;
  items: string;
  status: CartAction['status'];
  verified: number;
  detail: string | null;
  created_at: string;
}

function rowToAction(r: ActionRow): CartAction {
  return {
    id: r.id,
    planId: r.plan_id,
    martId: r.mart_id,
    cartUrl: r.cart_url,
    items: JSON.parse(r.items),
    status: r.status,
    verified: r.verified === 1,
    detail: r.detail ?? undefined,
    createdAt: r.created_at,
  };
}

export function refreshPlanExecution(plan: StoredPlan): void {
  const actions = store.getActionsByPlan(plan.id);
  if (actions.length === 0) return;
  let execution: StoredPlan['execution'];
  if (actions.every((a) => a.status === 'done')) execution = 'done';
  else if (actions.some((a) => a.status === 'failed')) execution = 'failed';
  else if (actions.some((a) => a.status === 'claimed')) execution = 'running';
  else execution = 'queued';
  if (execution !== plan.execution) {
    plan.execution = execution;
    store.setPlanExecution(plan.id, execution);
  }
}
