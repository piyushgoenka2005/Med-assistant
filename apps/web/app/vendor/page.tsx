'use client';

import { useEffect, useMemo, useState } from 'react';

type Vendor = {
  id: string;
  name?: string;
  currency?: string;
  baseDeliveryFee?: number;
};

type InventoryItem = {
  id?: string;
  name: string;
  stockQty: number;
  unitPrice: number;
  currency?: string;
};

type PricingRules = {
  offPeakStartHour?: number;
  offPeakEndHour?: number;
  offPeakPercent?: number;
  bulkMinSubtotal?: number;
  bulkPercent?: number;
  promoCodes?: Array<{ code: string; percent: number; active?: boolean }>;
};

export default function VendorDashboardPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState<string>('');

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [rules, setRules] = useState<PricingRules>({});
  const [analytics, setAnalytics] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedVendor = useMemo(() => vendors.find((v) => v.id === vendorId) ?? null, [vendors, vendorId]);

  async function loadVendors() {
    const res = await fetch('/v1/vendors');
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const list = Array.isArray(data?.vendors) ? (data.vendors as Vendor[]) : [];
    setVendors(list);
    if (!vendorId && list.length) setVendorId(list[0].id);
  }

  async function loadVendorData(id: string) {
    const [invRes, rulesRes, analyticsRes, reqRes] = await Promise.all([
      fetch(`/v1/vendors/${id}/inventory`),
      fetch(`/v1/vendors/${id}/pricing-rules`),
      fetch(`/v1/vendors/${id}/analytics`),
      fetch(`/v1/vendors/${id}/fulfillment-requests`)
    ]);

    if (!invRes.ok) throw new Error(await invRes.text());
    if (!rulesRes.ok) throw new Error(await rulesRes.text());
    if (!analyticsRes.ok) throw new Error(await analyticsRes.text());
    if (!reqRes.ok) throw new Error(await reqRes.text());

    const invJson = await invRes.json();
    const rulesJson = await rulesRes.json();
    const analyticsJson = await analyticsRes.json();
    const reqJson = await reqRes.json();

    setInventory(Array.isArray(invJson?.items) ? invJson.items : []);
    setRules((rulesJson?.rules ?? {}) as PricingRules);
    setAnalytics(analyticsJson);
    setRequests(Array.isArray(reqJson?.requests) ? reqJson.requests : []);
  }

  useEffect(() => {
    void (async () => {
      try {
        setError(null);
        await loadVendors();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!vendorId) return;
    void (async () => {
      try {
        setError(null);
        await loadVendorData(vendorId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    })();
  }, [vendorId]);

  async function saveInventory() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v1/vendors/${vendorId}/inventory`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: inventory
            .filter((i) => i.name.trim())
            .map((i) => ({
              name: i.name,
              stockQty: Number(i.stockQty) || 0,
              unitPrice: Number(i.unitPrice) || 0,
              currency: i.currency
            }))
        })
      });
      if (!res.ok) throw new Error(await res.text());
      await loadVendorData(vendorId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveRules() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v1/vendors/${vendorId}/pricing-rules`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rules)
      });
      if (!res.ok) throw new Error(await res.text());
      await loadVendorData(vendorId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function respondRequest(id: string, status: 'ACCEPTED' | 'REJECTED') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v1/vendors/${vendorId}/fulfillment-requests/${id}/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error(await res.text());
      await loadVendorData(vendorId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Vendor Dashboard</h2>
          <p className="text-gray-600 mt-1">Manage inventory, pricing rules, analytics, and fulfillment.</p>
        </div>
        <div className="w-64">
          <label className="label">Vendor</label>
          <select
            className="input"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name ?? v.id}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Inventory */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold text-gray-900">Inventory</h3>
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              type="button"
              onClick={() => setInventory((cur) => [...cur, { name: '', stockQty: 0, unitPrice: 0, currency: selectedVendor?.currency ?? 'INR' }])}
              disabled={busy}
            >
              Add Item
            </button>
            <button className="btn-primary" type="button" onClick={saveInventory} disabled={busy || !vendorId}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2 pr-4">Medicine</th>
                <th className="py-2 pr-4">Stock</th>
                <th className="py-2 pr-4">Unit Price</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((it, idx) => (
                <tr key={it.id ?? idx} className="border-t border-gray-200">
                  <td className="py-2 pr-4">
                    <input
                      className="input"
                      value={it.name}
                      onChange={(e) => setInventory((cur) => cur.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
                      placeholder="e.g. Paracetamol 500mg"
                    />
                  </td>
                  <td className="py-2 pr-4 w-40">
                    <input
                      className="input"
                      type="number"
                      value={it.stockQty}
                      onChange={(e) => setInventory((cur) => cur.map((x, i) => (i === idx ? { ...x, stockQty: Number(e.target.value) } : x)))}
                    />
                  </td>
                  <td className="py-2 pr-4 w-40">
                    <input
                      className="input"
                      type="number"
                      value={it.unitPrice}
                      onChange={(e) => setInventory((cur) => cur.map((x, i) => (i === idx ? { ...x, unitPrice: Number(e.target.value) } : x)))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pricing rules */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold text-gray-900">Dynamic Pricing Rules</h3>
          <button className="btn-primary" type="button" onClick={saveRules} disabled={busy || !vendorId}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Off-peak %</label>
            <input className="input" type="number" value={rules.offPeakPercent ?? 0} onChange={(e) => setRules((r) => ({ ...r, offPeakPercent: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="label">Bulk min subtotal</label>
            <input className="input" type="number" value={rules.bulkMinSubtotal ?? 0} onChange={(e) => setRules((r) => ({ ...r, bulkMinSubtotal: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="label">Bulk %</label>
            <input className="input" type="number" value={rules.bulkPercent ?? 0} onChange={(e) => setRules((r) => ({ ...r, bulkPercent: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="label">Off-peak hours (start → end)</label>
            <div className="flex gap-2">
              <input className="input" type="number" value={rules.offPeakStartHour ?? 22} onChange={(e) => setRules((r) => ({ ...r, offPeakStartHour: Number(e.target.value) }))} />
              <input className="input" type="number" value={rules.offPeakEndHour ?? 6} onChange={(e) => setRules((r) => ({ ...r, offPeakEndHour: Number(e.target.value) }))} />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-gray-900">Promo Codes (auto-apply)</h4>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => setRules((r) => ({ ...r, promoCodes: [...(r.promoCodes ?? []), { code: '', percent: 0, active: true }] }))}
            >
              Add Promo
            </button>
          </div>
          <div className="space-y-2">
            {(rules.promoCodes ?? []).map((p, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2">
                <div className="col-span-6">
                  <input className="input" value={p.code} placeholder="CODE" onChange={(e) => setRules((r) => ({
                    ...r,
                    promoCodes: (r.promoCodes ?? []).map((x, i) => (i === idx ? { ...x, code: e.target.value } : x))
                  }))} />
                </div>
                <div className="col-span-3">
                  <input className="input" type="number" value={p.percent} onChange={(e) => setRules((r) => ({
                    ...r,
                    promoCodes: (r.promoCodes ?? []).map((x, i) => (i === idx ? { ...x, percent: Number(e.target.value) } : x))
                  }))} />
                </div>
                <div className="col-span-3 flex items-center gap-2">
                  <input type="checkbox" checked={p.active !== false} onChange={(e) => setRules((r) => ({
                    ...r,
                    promoCodes: (r.promoCodes ?? []).map((x, i) => (i === idx ? { ...x, active: e.target.checked } : x))
                  }))} />
                  <span className="text-sm text-gray-700">Active</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Analytics */}
      <div className="card space-y-2">
        <h3 className="text-xl font-semibold text-gray-900">Analytics</h3>
        {analytics ? (
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <p className="text-gray-600">Orders</p>
              <p className="text-2xl font-bold text-gray-900">{analytics.orderCount ?? 0}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <p className="text-gray-600">Revenue</p>
              <p className="text-2xl font-bold text-gray-900">{(analytics.revenue ?? 0).toFixed?.(2) ?? analytics.revenue}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-600">Loading…</p>
        )}
      </div>

      {/* Fulfillment */}
      <div className="card space-y-4">
        <h3 className="text-xl font-semibold text-gray-900">Fulfillment Requests</h3>
        {requests.length ? (
          <div className="space-y-3">
            {requests.map((r) => (
              <div key={r.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">Order {r.orderId}</p>
                    <p className="text-sm text-gray-600">Status: {r.status}</p>
                    <p className="text-sm text-gray-600">Prescription: {r.prescriptionId}</p>
                  </div>
                  {r.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <button className="btn-secondary" type="button" disabled={busy} onClick={() => respondRequest(r.id, 'REJECTED')}>Reject</button>
                      <button className="btn-primary" type="button" disabled={busy} onClick={() => respondRequest(r.id, 'ACCEPTED')}>Accept</button>
                    </div>
                  )}
                </div>
                <div className="mt-3 text-sm text-gray-700">
                  <p className="font-medium">Items</p>
                  <ul className="list-disc ml-5">
                    {(r.items ?? []).map((it: any, idx: number) => (
                      <li key={idx}>{it.name} × {it.quantity}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-600">No requests yet.</p>
        )}
      </div>
    </div>
  );
}
