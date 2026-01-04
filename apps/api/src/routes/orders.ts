import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { getDb, Timestamp } from '../db/firestore.js';
import { collections } from '../db/collections.js';
import { scheduleDefaultReminders } from '../orchestrator/reminders.js';
import { buildCartFromExtraction } from '../orchestrator/rules.js';
import { env } from '../env.js';

export async function orderRoutes(app: FastifyInstance) {
  // Cash on delivery order placement.
  app.post('/cod', async (req, reply) => {
    const body = z.object({ prescriptionId: z.string().min(1) }).parse(req.body);

    const db = getDb();
    const presRef = db.collection(collections.prescriptions).doc(body.prescriptionId);
    const presSnap = await presRef.get();
    if (!presSnap.exists) return reply.notFound('Prescription not found');

    // Recompute pricing at order time to reflect real-time vendor prices via Pathway (if configured).
    const extractionSnap = await db.collection(collections.extractions).doc(body.prescriptionId).get();
    if (!extractionSnap.exists) return reply.badRequest('Extraction missing');
    const extractionDoc = extractionSnap.data();

    const cartSnap = await db.collection(collections.carts).doc(body.prescriptionId).get();
    const preferredVendorId = cartSnap.exists ? (cartSnap.data() as any)?.preferredVendorId : null;
    const refreshedCart = await buildCartFromExtraction({
      prescriptionId: body.prescriptionId,
      extractionJson: extractionDoc?.rawJson,
      preferredVendorId: preferredVendorId ?? null,
      commitPricing: true
    });

    if (refreshedCart?.status !== 'CONFIRMED') return reply.badRequest('Cart not confirmed');

    const paymentId = `cod_${crypto.randomUUID()}`;

    const pricing = (refreshedCart as any).pricing ?? {};
    const items = Array.isArray((refreshedCart as any).items) ? (refreshedCart as any).items : [];
    const vendorsUsed = Array.isArray((refreshedCart as any).vendorsUsed)
      ? (refreshedCart as any).vendorsUsed.map(String)
      : [String((refreshedCart as any).vendor ?? 'site-a')];

    // Place purchases per vendor (supports fallback split orders).
    const itemsByVendor = new Map<string, any[]>();
    for (const it of items) {
      const v = String(it.vendor ?? vendorsUsed[0] ?? 'site-a');
      if (!itemsByVendor.has(v)) itemsByVendor.set(v, []);
      itemsByVendor.get(v)!.push(it);
    }

    const vendorOrders: Array<{ vendor: string; vendorOrderId: string | null }> = [];
    for (const [vendor, vendorItems] of itemsByVendor.entries()) {
      let vendorOrderId: string | null = null;
      try {
        const purchaseRes = await fetch(
          `http://127.0.0.1:${env.API_PORT}/dummy/${encodeURIComponent(vendor)}/purchase`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              prescriptionId: body.prescriptionId,
              cartId: body.prescriptionId,
              currency: String(pricing.currency ?? 'INR'),
              deliveryFee: 0,
              total: Number(pricing.total ?? 0),
              items: vendorItems.map((it: any) => ({
                name: String(it.name ?? ''),
                quantity: Number(it.quantity ?? 1),
                unitPrice: Number(it.unitPrice ?? 0)
              }))
            })
          }
        );
        const purchaseOut = purchaseRes.ok ? ((await purchaseRes.json()) as any) : null;
        vendorOrderId = purchaseOut?.vendorOrderId ?? null;
      } catch {
        vendorOrderId = null;
      }

      vendorOrders.push({ vendor, vendorOrderId });
    }

    const orderRef = db.collection(collections.orders).doc();
    const order = {
      id: orderRef.id,
      createdAt: Timestamp.now(),
      prescriptionId: body.prescriptionId,
      cartId: body.prescriptionId,
      status: 'PLACED_WITH_PHARMACY',
      paymentProvider: 'cod',
      paymentRef: paymentId,
      pharmacyRef: null,
      vendor: vendorsUsed.length > 1 ? 'multi' : vendorsUsed[0],
      vendorsUsed,
      vendorOrders,
      currency: String(pricing.currency ?? 'INR'),
      total: Number(pricing.total ?? 0)
    };
    await orderRef.set(order);

    // Create fulfillment requests for vendor dashboard.
    for (const vo of vendorOrders) {
      await db.collection(collections.fulfillmentRequests).doc().set({
        createdAt: Timestamp.now(),
        orderId: orderRef.id,
        prescriptionId: body.prescriptionId,
        vendorId: vo.vendor,
        status: 'PENDING',
        items: (itemsByVendor.get(vo.vendor) ?? []).map((it: any) => ({
          name: String(it.name ?? ''),
          quantity: Number(it.quantity ?? 1)
        })),
        vendorOrderId: vo.vendorOrderId
      });
    }

    await presRef.update({
      updatedAt: Timestamp.now(),
      paymentType: 'COD',
      paymentId
    });

    await db.collection(collections.auditEvents).doc().set({
      createdAt: Timestamp.now(),
      prescriptionId: body.prescriptionId,
      action: 'ORDER_PLACED_COD',
      metadata: { orderId: orderRef.id, vendorsUsed, vendorOrders }
    });

    try {
      await scheduleDefaultReminders({ prescriptionId: body.prescriptionId, cartId: body.prescriptionId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.badRequest(`Google Calendar reminder scheduling failed: ${msg}`);
    }

    return reply.send({ order });
  });
}
