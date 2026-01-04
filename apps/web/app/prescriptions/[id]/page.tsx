'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function PrescriptionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<any>(null);

  async function load() {
    const res = await fetch(`/v1/prescriptions/${id}`);
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    setData(json);
    return json;
  }

  useEffect(() => {
    let alive = true;
    let attempts = 0;

    const tick = async () => {
      if (!alive) return;
      attempts += 1;

      try {
        const json = await load();

        if (json?.status === 'EXTRACTION_FAILED' && !error) {
          const message = json?.extraction?.error?.message;
          if (message) setError(String(message));
        }

        // Max ~3 minutes (90 * 2s) to avoid infinite polling.
        if (attempts >= 90) return;

        if (json?.status === 'EXTRACTING' || json?.status === 'UPLOADED') {
          setTimeout(() => void tick(), 2000);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed');
      }
    };

    void tick();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v1/prescriptions/${id}/confirm`, { method: 'POST' });
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
      const res = await fetch(`/v1/orders/cod`, {
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

  async function selectVendor(vendorId: 'site-a' | 'site-b' | 'site-c' | 'auto') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v1/prescriptions/${id}/select-vendor`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vendorId })
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vendor selection failed');
    } finally {
      setBusy(false);
    }
  }

  async function purchaseFromVendor(vendorId: 'site-a' | 'site-b' | 'site-c') {
    setBusy(true);
    setError(null);
    setOrder(null);
    try {
      const sel = await fetch(`/v1/prescriptions/${id}/select-vendor`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vendorId })
      });
      if (!sel.ok) throw new Error(await sel.text());

      const res = await fetch(`/v1/orders/cod`, {
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

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-primary-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">Loading prescription...</p>
        </div>
      </div>
    );
  }

  const extraction = data.extraction?.rawJson;
  const cart = data.cart;
  const medications = extraction?.medications || [];
  const discounts = cart?.pricing?.discounts || [];

  const statusColors: Record<string, string> = {
    UPLOADED: 'bg-blue-100 text-blue-800',
    EXTRACTED: 'bg-purple-100 text-purple-800',
    EXTRACTION_FAILED: 'bg-red-100 text-red-800',
    CONFIRMED: 'bg-green-100 text-green-800',
    PLACED_WITH_PHARMACY: 'bg-green-100 text-green-800'
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => router.push('/')}
            className="text-sm text-gray-600 hover:text-gray-900 mb-2 flex items-center"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Home
          </button>
          <h2 className="text-3xl font-bold text-gray-900">Prescription Details</h2>
          <p className="text-gray-600 mt-1">ID: {id}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[data.status] || 'bg-gray-100 text-gray-800'}`}>
          {data.status}
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p className="ml-3 text-sm text-red-800">{error}</p>
          </div>
        </div>
      )}

      {/* Extracted Medications */}
      <div className="card">
        <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
          <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          Extracted Medications
        </h3>
        {data.status === 'EXTRACTING' ? (
          <p className="text-gray-500 text-sm">Extracting… this may take up to a minute.</p>
        ) : medications.length > 0 ? (
          <div className="space-y-3">
            {medications.map((med: any, idx: number) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900">{med.name}</h4>
                    <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                      {med.strength && <div><span className="text-gray-500">Strength:</span> <span className="text-gray-900">{med.strength}</span></div>}
                      {med.form && <div><span className="text-gray-500">Form:</span> <span className="text-gray-900">{med.form}</span></div>}
                      {med.dosage && <div><span className="text-gray-500">Dosage:</span> <span className="text-gray-900">{med.dosage}</span></div>}
                      {med.frequency && <div><span className="text-gray-500">Frequency:</span> <span className="text-gray-900">{med.frequency}</span></div>}
                      {med.durationDays && <div><span className="text-gray-500">Duration:</span> <span className="text-gray-900">{med.durationDays} days</span></div>}
                      {med.quantity && <div><span className="text-gray-500">Quantity:</span> <span className="text-gray-900">{med.quantity}</span></div>}
                    </div>
                    {med.specialInstructions && (
                      <p className="mt-2 text-sm text-gray-600 italic">{med.specialInstructions}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No medications extracted yet.</p>
        )}
        
        {extraction && (
          <details className="mt-4">
            <summary className="text-sm text-gray-600 cursor-pointer hover:text-gray-900">View Raw JSON</summary>
            <pre className="mt-2 bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
              {JSON.stringify(extraction, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {/* Cart */}
      {cart && (
        <div className="card">
          <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
            <svg className="w-5 h-5 mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Shopping Cart
          </h3>

          {cart.vendor && (
            <div className="mb-4 flex items-center justify-between bg-primary-50 rounded-lg p-3">
              <div>
                <p className="text-sm text-gray-600">Selected Vendor</p>
                <p className="font-semibold text-gray-900 uppercase">{cart.vendor}</p>
                {Array.isArray(cart.vendorsUsed) && cart.vendorsUsed.length > 1 && (
                  <p className="text-xs text-gray-600 mt-1">Split across: {cart.vendorsUsed.join(', ')}</p>
                )}
              </div>
              {cart.pricing && (
                <div className="text-right">
                  <p className="text-2xl font-bold text-gray-900">
                    {cart.pricing.currency} {cart.pricing.total}
                  </p>
                  <p className="text-xs text-gray-500">
                    {cart.pricing.source === 'dynamic' ? 'Dynamic pricing applied' : 'Pricing'}
                  </p>
                </div>
              )}
            </div>
          )}

          {cart.delivery && (
            <div className="bg-gray-50 rounded-lg p-4 mb-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">ETA</span>
                <span className="text-gray-900">{cart.delivery.etaMinutes} min</span>
              </div>
              {cart.delivery.windowStart && cart.delivery.windowEnd && (
                <div className="flex justify-between mt-1">
                  <span className="text-gray-600">Delivery window</span>
                  <span className="text-gray-900">
                    {new Date(cart.delivery.windowStart).toLocaleTimeString()} – {new Date(cart.delivery.windowEnd).toLocaleTimeString()}
                  </span>
                </div>
              )}
            </div>
          )}

          {cart.pricing && (
            <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-2 text-sm">
              {typeof cart.pricing.baseSubtotal === 'number' && cart.pricing.baseSubtotal !== cart.pricing.subtotal && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Base Subtotal</span>
                  <span className="text-gray-900">{cart.pricing.currency} {cart.pricing.baseSubtotal}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal</span>
                <span className="text-gray-900">{cart.pricing.currency} {cart.pricing.subtotal}</span>
              </div>

              {Array.isArray(discounts) && discounts.length > 0 && (
                <div className="space-y-1">
                  {discounts.map((d: any, idx: number) => (
                    <div key={idx} className="flex justify-between text-xs">
                      <span className="text-gray-600">{d.label || d.code}</span>
                      <span className="text-gray-900">- {cart.pricing.currency} {d.amount}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between">
                <span className="text-gray-600">Delivery Fee</span>
                <span className="text-gray-900">{cart.pricing.currency} {cart.pricing.deliveryFee}</span>
              </div>
              <div className="border-t border-gray-200 pt-2 flex justify-between font-semibold">
                <span className="text-gray-900">Total</span>
                <span className="text-gray-900">{cart.pricing.currency} {cart.pricing.total}</span>
              </div>
            </div>
          )}

          {cart.totalsByVendor && (
            <details>
              <summary className="text-sm text-gray-600 cursor-pointer hover:text-gray-900">Compare Vendor Prices</summary>
              <div className="mt-2 space-y-2">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void selectVendor('auto')}
                    disabled={busy}
                    className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                  >
                    Auto select
                  </button>
                </div>
                {Object.entries(cart.totalsByVendor).map(([vendor, total]: [string, any]) => (
                  <div key={vendor} className="flex justify-between text-sm bg-gray-50 rounded p-2">
                    <span className="uppercase font-medium">{vendor}</span>
                    <div className="flex items-center gap-3">
                      <span>
                        {Number.isFinite(total)
                          ? `${cart.pricing?.currency || 'INR'} ${total}`
                          : 'Unavailable'}
                        {Number.isFinite(total) && typeof cart?.delivery?.etaByVendor?.[vendor] === 'number' && (
                          <span className="text-xs text-gray-600"> · {cart.delivery.etaByVendor[vendor]} min</span>
                        )}
                      </span>
                      {Number.isFinite(total) && ['site-a', 'site-b', 'site-c'].includes(vendor) && (
                        <button
                          type="button"
                          onClick={() => void purchaseFromVendor(vendor as any)}
                          disabled={busy}
                          className="text-xs px-2 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                        >
                          Buy
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          <details className="mt-4">
            <summary className="text-sm text-gray-600 cursor-pointer hover:text-gray-900">View Cart JSON</summary>
            <pre className="mt-2 bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
              {JSON.stringify(cart, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Order Confirmation */}
      {order && (
        <div className="card bg-green-50 border-green-200">
          <div className="flex items-start">
            <svg className="w-6 h-6 text-green-600 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="ml-3">
              <h3 className="text-lg font-semibold text-green-900">Order Placed Successfully!</h3>
              <p className="text-sm text-green-700 mt-1">Order ID: {order.id}</p>
              {order.vendorOrderId && (
                <p className="text-sm text-green-700">Vendor Order ID: {order.vendorOrderId}</p>
              )}
              <p className="text-sm text-green-600 mt-2">
                Your order has been placed with {order.vendor?.toUpperCase() || 'the pharmacy'}. Payment: Cash on Delivery
              </p>
            </div>
          </div>
          <details className="mt-4">
            <summary className="text-sm text-green-700 cursor-pointer hover:text-green-900">View Order Details</summary>
            <pre className="mt-2 bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
              {JSON.stringify(order, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        {!cart && (
          <button onClick={confirm} disabled={busy} className="btn-primary">
            {busy ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 inline" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing...
              </>
            ) : (
              'Confirm & Build Cart'
            )}
          </button>
        )}
        
        {cart && !order && (
          <button
            onClick={goCheckout}
            disabled={busy || cart.status !== 'CONFIRMED'}
            className="btn-primary"
          >
            {busy ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 inline" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Placing Order...
              </>
            ) : (
              <>
                <svg className="w-5 h-5 mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Place Order (COD)
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
