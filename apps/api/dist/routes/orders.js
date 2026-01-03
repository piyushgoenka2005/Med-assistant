import { z } from 'zod';
import crypto from 'node:crypto';
import { getDb, Timestamp } from '../db/firestore.js';
import { collections } from '../db/collections.js';
import { scheduleDefaultReminders } from '../orchestrator/reminders.js';
import { buildCartFromExtraction } from '../orchestrator/rules.js';
import { env } from '../env.js';
export async function orderRoutes(app) {
    // Cash on delivery order placement.
    app.post('/cod', async (req, reply) => {
        const body = z.object({ prescriptionId: z.string().min(1) }).parse(req.body);
        const db = getDb();
        const presRef = db.collection(collections.prescriptions).doc(body.prescriptionId);
        const presSnap = await presRef.get();
        if (!presSnap.exists)
            return reply.notFound('Prescription not found');
        // Recompute pricing at order time to reflect real-time vendor prices via Pathway (if configured).
        const extractionSnap = await db.collection(collections.extractions).doc(body.prescriptionId).get();
        if (!extractionSnap.exists)
            return reply.badRequest('Extraction missing');
        const extractionDoc = extractionSnap.data();
        const refreshedCart = await buildCartFromExtraction({
            prescriptionId: body.prescriptionId,
            extractionJson: extractionDoc?.rawJson
        });
        if (refreshedCart?.status !== 'CONFIRMED')
            return reply.badRequest('Cart not confirmed');
        const paymentId = `cod_${crypto.randomUUID()}`;
        // Place the purchase with the selected dummy vendor, and record vendor order history.
        const vendor = String(refreshedCart.vendor ?? 'site-a');
        const pricing = refreshedCart.pricing ?? {};
        const items = Array.isArray(refreshedCart.items) ? refreshedCart.items : [];
        let vendorOrderId = null;
        try {
            const purchaseRes = await fetch(`http://127.0.0.1:${env.API_PORT}/dummy/${encodeURIComponent(vendor)}/purchase`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    prescriptionId: body.prescriptionId,
                    cartId: body.prescriptionId,
                    currency: String(pricing.currency ?? 'INR'),
                    deliveryFee: Number(pricing.deliveryFee ?? 0),
                    total: Number(pricing.total ?? 0),
                    items: items.map((it) => ({
                        name: String(it.name ?? ''),
                        quantity: Number(it.quantity ?? 1),
                        unitPrice: Number(it.unitPrice ?? 0)
                    }))
                })
            });
            const purchaseOut = purchaseRes.ok ? (await purchaseRes.json()) : null;
            vendorOrderId = purchaseOut?.vendorOrderId ?? null;
        }
        catch {
            vendorOrderId = null;
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
            vendor,
            vendorOrderId
        };
        await orderRef.set(order);
        await presRef.update({
            updatedAt: Timestamp.now(),
            paymentType: 'COD',
            paymentId
        });
        await db.collection(collections.auditEvents).doc().set({
            createdAt: Timestamp.now(),
            prescriptionId: body.prescriptionId,
            action: 'ORDER_PLACED_COD',
            metadata: { orderId: orderRef.id, vendor, vendorOrderId }
        });
        await scheduleDefaultReminders({ prescriptionId: body.prescriptionId, cartId: body.prescriptionId });
        return reply.send({ order });
    });
}
