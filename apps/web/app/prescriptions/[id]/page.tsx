'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export default function PrescriptionPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<any>(null);

  async function load() {
    const res = await fetch(`${API_BASE}/v1/prescriptions/${id}`);
    if (!res.ok) throw new Error(await res.text());
    setData(await res.json());
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/prescriptions/${id}/confirm`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirm failed');
    } finally {
      setBusy(false);
    }
  }

  async function goCheckout() {
    setBusy(true);
    setError(null);
    setOrder(null);
    try {
      const res = await fetch(`${API_BASE}/v1/orders/cod`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prescriptionId: id })
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      setOrder(out.order);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Order failed');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div>Loading...</div>;

  const extraction = data.extraction?.rawJson;
  const cart = data.cart;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <div>
          <b>Status:</b> {data.status}
        </div>
      </div>

      <section>
        <h2 style={{ margin: '8px 0' }}>Extracted JSON</h2>
        <pre style={{ background: '#f6f6f6', padding: 12, overflowX: 'auto' }}>
          {JSON.stringify(extraction, null, 2)}
        </pre>
      </section>

      <section>
        <h2 style={{ margin: '8px 0' }}>Cart</h2>
        {cart ? (
          <pre style={{ background: '#f6f6f6', padding: 12, overflowX: 'auto' }}>
            {JSON.stringify(cart, null, 2)}
          </pre>
        ) : (
          <div>No cart yet.</div>
        )}
      </section>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={confirm} disabled={busy}>
          {busy ? 'Working...' : 'Confirm Prescription & Auto-Add to Cart'}
        </button>
        <button onClick={goCheckout} disabled={busy || !cart || cart.status !== 'CONFIRMED'}>
          Place Order (Cash on Delivery)
        </button>
      </div>

      {order ? (
        <section>
          <h2 style={{ margin: '8px 0' }}>Order</h2>
          <pre style={{ background: '#f6f6f6', padding: 12, overflowX: 'auto' }}>{JSON.stringify(order, null, 2)}</pre>
        </section>
      ) : null}

      {error ? <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>{error}</pre> : null}
    </div>
  );
}
