import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { getDb, Timestamp } from '../db/firestore.js';
import { collections } from '../db/collections.js';

function priceFor(name: string, site: 'site-a' | 'site-b' | 'site-c') {
  const base = Array.from(name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 97;
  const multipliers: Record<typeof site, number> = {
    'site-a': 1.0,
    'site-b': 0.92,
    'site-c': 1.08
  };

  const unitPrice = Math.max(10, Math.round((50 + base) * multipliers[site]));
  const deliveryFee = site === 'site-b' ? 25 : site === 'site-a' ? 35 : 15;
  const available = base % (site === 'site-c' ? 5 : 7) !== 0;
  return { unitPrice, deliveryFee, currency: 'INR', available };
}

function renderHtml(site: 'site-a' | 'site-b' | 'site-c', name: string, qty: number) {
  const offer = priceFor(name, site);
  const total = offer.unitPrice * qty + offer.deliveryFee;
  // Expose a stable DOM structure for browser automation.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${site.toUpperCase()} Pharmacy</title>
</head>
<body>
  <h1 data-site="${site}">${site.toUpperCase()} Pharmacy</h1>
  <div id="result" data-med="${escapeHtml(name)}" data-qty="${qty}" data-currency="${offer.currency}">
    <table>
      <thead>
        <tr><th>Medicine</th><th>Unit Price</th><th>Qty</th><th>Delivery</th><th>Available</th><th>Total</th></tr>
      </thead>
      <tbody>
        <tr data-offer-row>
          <td data-med-name>${escapeHtml(name)}</td>
          <td data-unit-price>${offer.unitPrice}</td>
          <td data-qty>${qty}</td>
          <td data-delivery-fee>${offer.deliveryFee}</td>
          <td data-available>${offer.available ? 'YES' : 'NO'}</td>
          <td data-total>${total}</td>
        </tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

function escapeHtml(input: string) {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function dummySiteRoutes(app: FastifyInstance) {
  const Query = z.object({ name: z.string().min(1), qty: z.coerce.number().int().positive().default(1) });

  const PurchaseBody = z.object({
    prescriptionId: z.string().min(1),
    cartId: z.string().min(1),
    currency: z.string().default('INR'),
    items: z
      .array(
        z.object({
          name: z.string().min(1),
          quantity: z.coerce.number().int().positive(),
          unitPrice: z.coerce.number().nonnegative()
        })
      )
      .min(1),
    deliveryFee: z.coerce.number().nonnegative().default(0),
    total: z.coerce.number().nonnegative()
  });

  for (const site of ['site-a', 'site-b', 'site-c'] as const) {
    app.get(`/${site}`, async (req, reply) => {
      const { name, qty } = Query.parse(req.query);
      const accept = String(req.headers.accept ?? '');
      const offer = priceFor(name, site);
      const total = offer.unitPrice * qty + offer.deliveryFee;

      if (accept.includes('application/json')) {
        return reply.send({ site, name, qty, ...offer, total });
      }

      reply.header('content-type', 'text/html; charset=utf-8');
      return reply.send(renderHtml(site, name, qty));
    });

    // Place a purchase at this dummy vendor. This is what makes the order
    // appear in the vendor's order history page.
    app.post(`/${site}/purchase`, async (req, reply) => {
      const body = PurchaseBody.parse(req.body);
      const db = getDb();

      const vendorOrderId = `${site}_${crypto.randomUUID()}`;
      const ref = db.collection(collections.vendorOrders).doc(vendorOrderId);
      await ref.set({
        id: vendorOrderId,
        vendor: site,
        createdAt: Timestamp.now(),
        prescriptionId: body.prescriptionId,
        cartId: body.cartId,
        currency: body.currency,
        items: body.items,
        deliveryFee: body.deliveryFee,
        total: body.total,
        status: 'PLACED'
      });

      return reply.send({ ok: true, vendor: site, vendorOrderId });
    });

    // Vendor order history. Use Accept: application/json for data.
    app.get(`/${site}/orders`, async (req, reply) => {
      const db = getDb();
      const snap = await db
        .collection(collections.vendorOrders)
        .where('vendor', '==', site)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      const orders = snap.docs.map((d) => d.data());
      const accept = String(req.headers.accept ?? '');

      if (accept.includes('application/json')) {
        return reply.send({ vendor: site, orders });
      }

      reply.header('content-type', 'text/html; charset=utf-8');
      const rows = orders
        .map((o: any) => {
          const items = Array.isArray(o.items)
            ? o.items
                .map((i: any) => `${escapeHtml(String(i.name))} x${escapeHtml(String(i.quantity))}`)
                .join('<br/>')
            : '';

          return `
            <tr>
              <td>${escapeHtml(String(o.id ?? ''))}</td>
              <td>${escapeHtml(String(o.prescriptionId ?? ''))}</td>
              <td>${items}</td>
              <td>${escapeHtml(String(o.currency ?? 'INR'))} ${escapeHtml(String(o.total ?? ''))}</td>
              <td>${escapeHtml(String(o.status ?? ''))}</td>
            </tr>`;
        })
        .join('');

      return reply.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${site.toUpperCase()} Orders</title>
</head>
<body>
  <h1>${site.toUpperCase()} Order History</h1>
  <p><a href="/dummy/${site}">Back to pricing</a></p>
  <table border="1" cellpadding="6" cellspacing="0">
    <thead>
      <tr><th>Vendor Order ID</th><th>Prescription ID</th><th>Items</th><th>Total</th><th>Status</th></tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="5">No orders yet</td></tr>'}
    </tbody>
  </table>
</body>
</html>`);
    });
  }
}
