import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { orchestrateExtraction } from '../orchestrator/extraction.js';
import { buildCartFromExtraction } from '../orchestrator/rules.js';
import { PrescriptionExtractionSchema, type MedicationExtracted } from '@medi/shared';
import { getDb, Timestamp } from '../db/firestore.js';
import { collections } from '../db/collections.js';

export async function prescriptionRoutes(app: FastifyInstance) {
  app.get('/:id', async (req, reply) => {
    const id = z.object({ id: z.string() }).parse(req.params).id;
    const db = getDb();
    const presSnap = await db.collection(collections.prescriptions).doc(id).get();
    if (!presSnap.exists) return reply.notFound('Prescription not found');
    const pres = presSnap.data();

    const [uploadSnap, extractionSnap, cartSnap] = await Promise.all([
      pres?.uploadId ? db.collection(collections.uploads).doc(String(pres.uploadId)).get() : Promise.resolve(null as any),
      db.collection(collections.extractions).doc(id).get(),
      db.collection(collections.carts).doc(id).get()
    ]);

    return reply.send({
      id,
      ...pres,
      upload: uploadSnap?.exists ? uploadSnap.data() : null,
      extraction: extractionSnap.exists ? extractionSnap.data() : null,
      cart: cartSnap.exists ? cartSnap.data() : null
    });
  });

  app.post('/:id/extract', async (req, reply) => {
    const id = z.object({ id: z.string() }).parse(req.params).id;
    const db = getDb();
    const presSnap = await db.collection(collections.prescriptions).doc(id).get();
    if (!presSnap.exists) return reply.notFound('Prescription not found');
    const extraction = await orchestrateExtraction({ prescriptionId: id });
    return reply.send({ extractionId: extraction.extractionId, extraction: extraction.extraction });
  });

  app.post('/:id/confirm', async (req, reply) => {
    const id = z.object({ id: z.string() }).parse(req.params).id;
    const db = getDb();
    const presRef = db.collection(collections.prescriptions).doc(id);
    const presSnap = await presRef.get();
    if (!presSnap.exists) return reply.notFound('Prescription not found');

    const extractionSnap = await db.collection(collections.extractions).doc(id).get();
    if (!extractionSnap.exists) return reply.badRequest('Extraction missing');
    const extractionDoc = extractionSnap.data();

    if (!extractionDoc?.rawJson || extractionDoc?.status !== 'COMPLETED') {
      return reply.badRequest('Extraction not completed yet');
    }

    const extracted = PrescriptionExtractionSchema.parse(extractionDoc?.rawJson);

    const existingCartSnap = await db.collection(collections.carts).doc(id).get();
    const preferredVendorId = existingCartSnap.exists
      ? (existingCartSnap.data() as any)?.preferredVendorId
      : null;

    const cart = await buildCartFromExtraction({
      prescriptionId: id,
      extractionJson: extractionDoc?.rawJson,
      preferredVendorId: preferredVendorId ?? null,
      commitPricing: false
    });

    const medicines = extracted.medications.map((m: MedicationExtracted) => ({
      name: m.name,
      dosage: m.dosage ?? null,
      freq: m.frequency ?? null,
      duration: m.durationDays ?? null,
      when: m.specialInstructions ?? null
    }));

    const pres = presSnap.data() ?? {};
    await presRef.update({
      updatedAt: Timestamp.now(),
      status: 'CONFIRMED',
      medicines,
      paymentType: 'COD'
    });

    // Mirror into customer.records if present
    const customerId = pres.customerId ? String(pres.customerId) : null;
    if (customerId) {
      const customerRef = db.collection(collections.customers).doc(customerId);
      const customerSnap = await customerRef.get();
      if (customerSnap.exists) {
        const customer = customerSnap.data() ?? {};
        const existingRecords = Array.isArray(customer.records) ? (customer.records as any[]) : [];
        const updatedRecords = existingRecords.map((r) => {
          const rid = r?.prescription?.id;
          if (rid !== id) return r;
          return { ...r, prescription: { ...r.prescription, medicines } };
        });
        await customerRef.update({ updatedAt: Timestamp.now(), records: updatedRecords });
      }
    }

    await db.collection(collections.auditEvents).doc().set({
      createdAt: Timestamp.now(),
      prescriptionId: id,
      action: 'PRESCRIPTION_CONFIRMED',
      metadata: null
    });

    return reply.send({ cart });
  });

  // Allow user to choose a specific vendor site when multiple are available.
  app.post('/:id/select-vendor', async (req, reply) => {
    const id = z.object({ id: z.string() }).parse(req.params).id;
    const body = z
      .object({ vendorId: z.enum(['site-a', 'site-b', 'site-c', 'auto']) })
      .parse(req.body);

    const db = getDb();
    const presSnap = await db.collection(collections.prescriptions).doc(id).get();
    if (!presSnap.exists) return reply.notFound('Prescription not found');

    const extractionSnap = await db.collection(collections.extractions).doc(id).get();
    if (!extractionSnap.exists) return reply.badRequest('Extraction missing');
    const extractionDoc = extractionSnap.data();
    if (!extractionDoc?.rawJson || extractionDoc?.status !== 'COMPLETED') {
      return reply.badRequest('Extraction not completed yet');
    }

    const preferredVendorId = body.vendorId === 'auto' ? null : body.vendorId;
    await db.collection(collections.carts).doc(id).set({ preferredVendorId }, { merge: true });

    const cart = await buildCartFromExtraction({
      prescriptionId: id,
      extractionJson: extractionDoc?.rawJson,
      preferredVendorId,
      commitPricing: false
    });

    return reply.send({ cart });
  });
}
