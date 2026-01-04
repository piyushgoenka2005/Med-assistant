import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb, Timestamp } from '../db/firestore.js';
import { collections } from '../db/collections.js';
import { DEFAULT_VENDOR_IDS, ensureVendorSeed, inventoryDocId } from '../orchestrator/vendorData.js';

const VendorIdSchema = z.enum(['site-a', 'site-b', 'site-c']);

export async function vendorRoutes(app: FastifyInstance) {
  const db = getDb();

  app.get('/', async (_req, reply) => {
    await ensureVendorSeed(db);
    const snap = await db.collection(collections.vendors).get();
    const vendors = snap.docs.map((d) => d.data());
    return reply.send({ vendors });
  });

  app.get('/:vendorId/inventory', async (req, reply) => {
    await ensureVendorSeed(db);
    const vendorId = VendorIdSchema.parse((req.params as any).vendorId);

    const snap = await db.collection(collections.vendorInventory).where('vendorId', '==', vendorId).get();
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    return reply.send({ vendorId, items });
  });

  app.put('/:vendorId/inventory', async (req, reply) => {
    await ensureVendorSeed(db);
    const vendorId = VendorIdSchema.parse((req.params as any).vendorId);

    const body = z.object({
      items: z
        .array(
          z.object({
            name: z.string().min(1),
            stockQty: z.number().int().min(0),
            unitPrice: z.number().min(0),
            currency: z.string().optional()
          })
        )
        .default([])
    }).parse(req.body);

    const batch = db.batch();
    for (const it of body.items) {
      const ref = db.collection(collections.vendorInventory).doc(inventoryDocId(vendorId, it.name));
      batch.set(
        ref,
        {
          vendorId,
          name: it.name,
          nameLower: it.name.trim().toLowerCase(),
          stockQty: it.stockQty,
          unitPrice: it.unitPrice,
          currency: it.currency ?? 'INR',
          updatedAt: Timestamp.now()
        },
        { merge: true }
      );
    }
    await batch.commit();

    return reply.send({ ok: true });
  });

  app.get('/:vendorId/pricing-rules', async (req, reply) => {
    await ensureVendorSeed(db);
    const vendorId = VendorIdSchema.parse((req.params as any).vendorId);

    const snap = await db.collection(collections.vendorPricingRules).doc(vendorId).get();
    return reply.send({ vendorId, rules: snap.data() ?? null });
  });

  app.put('/:vendorId/pricing-rules', async (req, reply) => {
    await ensureVendorSeed(db);
    const vendorId = VendorIdSchema.parse((req.params as any).vendorId);

    const body = z
      .object({
        offPeakStartHour: z.number().int().min(0).max(23).optional(),
        offPeakEndHour: z.number().int().min(0).max(23).optional(),
        offPeakPercent: z.number().min(0).max(100).optional(),
        bulkMinSubtotal: z.number().min(0).optional(),
        bulkPercent: z.number().min(0).max(100).optional(),
        promoCodes: z
          .array(
            z.object({
              code: z.string().min(1),
              percent: z.number().min(0).max(100),
              active: z.boolean().optional()
            })
          )
          .optional()
      })
      .parse(req.body);

    await db.collection(collections.vendorPricingRules).doc(vendorId).set(
      {
        vendorId,
        ...body,
        updatedAt: Timestamp.now()
      },
      { merge: true }
    );

    return reply.send({ ok: true });
  });

  app.get('/:vendorId/analytics', async (req, reply) => {
    await ensureVendorSeed(db);
    const vendorId = VendorIdSchema.parse((req.params as any).vendorId);

    const ordersSnap = await db.collection(collections.orders).where('vendorsUsed', 'array-contains', vendorId).get();
    const orders = ordersSnap.docs.map((d) => d.data() as any);

    const orderCount = orders.length;
    const revenue = orders.reduce((acc, o) => acc + (Number(o.total ?? 0) || 0), 0);

    return reply.send({ vendorId, orderCount, revenue });
  });

  app.get('/:vendorId/fulfillment-requests', async (req, reply) => {
    await ensureVendorSeed(db);
    const vendorId = VendorIdSchema.parse((req.params as any).vendorId);

    // Avoid requiring a composite index (vendorId + createdAt) by sorting client-side.
    // This keeps the dev/demo experience working without manual Firestore index creation.
    const snap = await db.collection(collections.fulfillmentRequests).where('vendorId', '==', vendorId).get();

    const requests = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .sort((a, b) => {
        const aMs = (a?.createdAt?.toMillis?.() as number | undefined) ?? 0;
        const bMs = (b?.createdAt?.toMillis?.() as number | undefined) ?? 0;
        return bMs - aMs;
      })
      .slice(0, 50);
    return reply.send({ vendorId, requests });
  });

  app.post('/:vendorId/fulfillment-requests/:id/respond', async (req, reply) => {
    const vendorId = VendorIdSchema.parse((req.params as any).vendorId);
    const id = z.string().min(1).parse((req.params as any).id);

    const body = z.object({ status: z.enum(['ACCEPTED', 'REJECTED']) }).parse(req.body);

    await db.collection(collections.fulfillmentRequests).doc(id).set(
      {
        vendorId,
        status: body.status,
        respondedAt: Timestamp.now()
      },
      { merge: true }
    );

    return reply.send({ ok: true });
  });
}
