import { useEffect, useRef, useState } from 'react';
import type { Mart, Product } from '@grocery/core';
import { api, krw, type IngestStatus, type StoredPlan } from './api';

type CatalogMart = Pick<Mart, 'id' | 'name' | 'shippingFee' | 'freeShippingThreshold'>;

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [marts, setMarts] = useState<CatalogMart[]>([]);
  const [ingest, setIngest] = useState<IngestStatus | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [plan, setPlan] = useState<StoredPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    api
      .catalog()
      .then(({ products, marts }) => {
        setProducts(products);
        setMarts(marts);
        // 데모 기본 장바구니
        setQuantities({ 'milk-1l': 2, 'eggs-30': 1, 'rice-10kg': 1, 'pork-500g': 1, 'banana-1kg': 1 });
      })
      .catch(() => setError('서버에 연결할 수 없습니다. `npm run dev:server`가 실행 중인지 확인하세요.'));
    api.ingestStatus().then(setIngest).catch(() => {});
    return () => stopPolling();
  }, []);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const setQty = (id: string, qty: number) => {
    setQuantities((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  };

  const runOptimize = async () => {
    setBusy(true);
    setError(null);
    stopPolling();
    try {
      const items = Object.entries(quantities).map(([productId, quantity]) => ({ productId, quantity }));
      const result = await api.optimize(items);
      setPlan(result);
      setIngest(await api.ingestStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runExecute = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      await api.execute(plan.id);
      pollRef.current = window.setInterval(async () => {
        const updated = await api.plan(plan.id).catch(() => null);
        if (!updated) return;
        setPlan(updated);
        if (updated.execution === 'done' || updated.execution === 'failed') stopPolling();
      }, 2000);
      setPlan(await api.plan(plan.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const itemCount = Object.keys(quantities).length;

  return (
    <div className="wrap">
      <header>
        <h1>🛒 스마트 장보기 에이전트</h1>
        <p className="sub">이마트 쓱배송 · 홈플러스 · 쿠팡 로켓프레시 — 쿠폰과 배송비까지 계산한 최저가 장바구니 분할</p>
      </header>

      {ingest && (
        <div className="sources">
          {ingest.marts.map((m) => (
            <span key={m.martId} className={`badge ${m.source}`}>
              {m.name}: {m.source === 'live' ? `실데이터 (${m.offerCount}개 상품)` : 'mock 데이터'}
            </span>
          ))}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <section className="card">
        <h2>1. 장보기 목록</h2>
        <div className="grid">
          {products.map((p) => {
            const qty = quantities[p.id] ?? 0;
            return (
              <div key={p.id} className={`product ${qty > 0 ? 'selected' : ''}`}>
                <span className="pname">
                  {p.name} <small>{p.unit}</small>
                </span>
                <span className="qty">
                  <button onClick={() => setQty(p.id, qty - 1)} disabled={qty === 0}>
                    −
                  </button>
                  <b>{qty}</b>
                  <button onClick={() => setQty(p.id, qty + 1)}>＋</button>
                </span>
              </div>
            );
          })}
        </div>
        <button className="primary" onClick={runOptimize} disabled={busy || itemCount === 0}>
          {busy ? '계산 중...' : `${itemCount}개 품목 최적 조합 찾기`}
        </button>
      </section>

      {plan && (
        <section className="card">
          <h2>2. 최적화 결과</h2>
          <div className="summary">
            <div>
              <span className="label">총 결제 예상 금액</span>
              <span className="total">{krw(plan.plan.grandTotal)}</span>
            </div>
            {plan.plan.savings !== null && plan.plan.savings > 0 && (
              <div>
                <span className="label">한 마트에서 다 살 때보다</span>
                <span className="savings">{krw(plan.plan.savings)} 절약</span>
              </div>
            )}
            <span className="strategy">탐색: {plan.plan.strategy === 'exhaustive' ? '전수 탐색(최적해)' : '휴리스틱'}</span>
          </div>

          <div className="baskets">
            {plan.plan.baskets.map((b) => (
              <div key={b.martId} className="basket">
                <h3>{b.martName}</h3>
                <ul>
                  {b.lines.map((l) => (
                    <li key={l.productId}>
                      {l.name} × {l.quantity} <span>{krw(l.lineTotal)}</span>
                    </li>
                  ))}
                </ul>
                <div className="row">
                  <span>소계</span>
                  <span>{krw(b.subtotal)}</span>
                </div>
                <div className="row">
                  <span>배송비</span>
                  <span>{b.shippingFee === 0 ? '무료' : krw(b.shippingFee)}</span>
                </div>
                {b.coupon && (
                  <div className="row coupon">
                    <span>🎟 {b.coupon.name}</span>
                    <span>−{krw(b.coupon.discount)}</span>
                  </div>
                )}
                <div className="row grand">
                  <span>결제 금액</span>
                  <span>{krw(b.total)}</span>
                </div>
                {b.slot && (
                  <div className="slot">
                    🚚 {b.slot.date} {b.slot.timeRange}
                  </div>
                )}
              </div>
            ))}
          </div>

          {plan.plan.unassigned.length > 0 && (
            <div className="unassigned">
              ⚠️ 담지 못한 상품: {plan.plan.unassigned.map((u) => `${u.name}(${u.reason})`).join(', ')}
            </div>
          )}

          <details className="baselines">
            <summary>단일 마트 구매 시 비교</summary>
            <ul>
              {plan.plan.baselines.map((b) => (
                <li key={b.martId}>
                  {b.martName}: {b.total === null ? '전 품목 구매 불가' : krw(b.total)}
                </li>
              ))}
            </ul>
          </details>

          <h2>3. 장바구니 담기</h2>
          {plan.execution === 'idle' && (
            <button className="primary" onClick={runExecute} disabled={busy}>
              익스텐션으로 각 마트 장바구니에 자동 담기
            </button>
          )}
          {plan.execution !== 'idle' && (
            <div className={`exec ${plan.execution}`}>
              {plan.execution === 'queued' && '⏳ 익스텐션이 작업을 가져가길 기다리는 중... (크롬에서 익스텐션이 켜져 있어야 합니다)'}
              {plan.execution === 'running' && '🔄 마트 장바구니에 담는 중...'}
              {plan.execution === 'done' && '✅ 모든 마트 장바구니 담기 완료! 각 마트에서 결제만 하면 됩니다.'}
              {plan.execution === 'failed' && '❌ 일부 마트 담기 실패 — 아래 상세를 확인하세요.'}
              {plan.actions && (
                <ul>
                  {plan.actions.map((a) => (
                    <li key={a.id}>
                      {marts.find((m) => m.id === a.martId)?.name ?? a.martId}: {a.status}
                      {a.detail ? ` — ${a.detail}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
