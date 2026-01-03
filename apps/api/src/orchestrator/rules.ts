import { PrescriptionExtractionSchema, type MedicationExtracted } from '@medi/shared';
import { getDb, Timestamp } from '../db/firestore.js';
import { collections } from '../db/collections.js';
import { getBestOffersForMedications, type VendorId } from './pricing.js';
import { quoteViaPathway } from '../integrations/pathway.js';

export async function buildCartFromExtraction(input: {
  prescriptionId: string;
  extractionJson: unknown;
}) {
  const extraction = PrescriptionExtractionSchema.parse(input.extractionJson);

  const best = await getBestOffersForMedications({ medications: extraction.medications });

  // Compute real-time totals (optionally via Pathway) for all vendors,
  // then select the vendor with the lowest quoted total.
  const vendors: VendorId[] = ['site-a', 'site-b', 'site-c'];
  const perVendorQuote: Record<VendorId, { subtotal: number; deliveryFee: number; currency: string; total: number; source: string }> = {
    'site-a': { subtotal: 0, deliveryFee: 0, currency: best.currency, total: 0, source: 'local' },
    'site-b': { subtotal: 0, deliveryFee: 0, currency: best.currency, total: 0, source: 'local' },
    'site-c': { subtotal: 0, deliveryFee: 0, currency: best.currency, total: 0, source: 'local' }
  };

  for (const vendor of vendors) {
    const offers = best.offers.filter((o) => o.vendor === vendor);
    const currency = offers[0]?.currency ?? best.currency;
    const deliveryFee = offers[0]?.deliveryFee ?? 0;
    const subtotal = offers.reduce((acc, o) => (o.available ? acc + o.unitPrice * o.quantity : Number.POSITIVE_INFINITY), 0);

    if (!Number.isFinite(subtotal)) {
      perVendorQuote[vendor] = { subtotal, deliveryFee, currency, total: Number.POSITIVE_INFINITY, source: 'local' };
      continue;
    }

    const quoted = await quoteViaPathway({ selectedVendor: vendor, subtotal, deliveryFee, currency });
    perVendorQuote[vendor] = {
      subtotal,
      deliveryFee: quoted.deliveryFee,
      currency: quoted.currency,
      total: quoted.total,
      source: quoted.source
    };
  }

  const selectedVendor = vendors.reduce((bestVendor, vendor) =>
    perVendorQuote[vendor].total < perVendorQuote[bestVendor].total ? vendor : bestVendor
  , vendors[0]);

  const selectedOffers = best.offers.filter((o) => o.vendor === selectedVendor);
  const offerByName = new Map(selectedOffers.map((o) => [o.medicationName.toLowerCase(), o] as const));

  const db = getDb();
  const cartRef = db.collection(collections.carts).doc(input.prescriptionId);
  const items = extraction.medications.map((m: MedicationExtracted) => ({
    name: m.name,
    strength: m.strength ?? null,
    form: m.form ?? null,
    dosage: m.dosage ?? null,
    frequency: m.frequency ?? null,
    durationDays: m.durationDays ?? null,
    quantity: m.quantity ?? null,
    instructions: m.specialInstructions ?? null,
    available: offerByName.get(m.name.toLowerCase())?.available ?? true,
    unitPrice: offerByName.get(m.name.toLowerCase())?.unitPrice ?? null
  }));

  const subtotal = selectedOffers.reduce((acc, o) => acc + (o.available ? o.unitPrice * o.quantity : 0), 0);
  const quote = perVendorQuote[selectedVendor];

  await cartRef.set(
    {
      createdAt: Timestamp.now(),
      prescriptionId: input.prescriptionId,
      status: 'CONFIRMED',
      items,
      vendor: selectedVendor,
      pricing: {
        currency: quote.currency,
        subtotal: quote.subtotal,
        deliveryFee: quote.deliveryFee,
        total: quote.total,
        source: quote.source
      },
      totalsByVendor: {
        'site-a': perVendorQuote['site-a'].total,
        'site-b': perVendorQuote['site-b'].total,
        'site-c': perVendorQuote['site-c'].total
      }
    },
    { merge: true }
  );

  return {
    id: cartRef.id,
    prescriptionId: input.prescriptionId,
    status: 'CONFIRMED',
    items,
    vendor: selectedVendor,
    pricing: {
      currency: quote.currency,
      subtotal: quote.subtotal,
      deliveryFee: quote.deliveryFee,
      total: quote.total,
      source: quote.source
    },
    totalsByVendor: {
      'site-a': perVendorQuote['site-a'].total,
      'site-b': perVendorQuote['site-b'].total,
      'site-c': perVendorQuote['site-c'].total
    }
  };
}
