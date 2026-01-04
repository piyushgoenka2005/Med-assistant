import { PrescriptionExtractionSchema, type MedicationExtracted } from '@medi/shared';
import { getDb, Timestamp } from '../db/firestore.js';
import { collections } from '../db/collections.js';
import type { VendorId } from './pricing.js';
import { applyDynamicPricing } from './dynamicPricing.js';
import { DEFAULT_VENDOR_IDS, ensureVendorSeed, inventoryDocId } from './vendorData.js';
import { quoteViaPathway } from '../integrations/pathway.js';

function candidateInventoryNames(m: MedicationExtracted): string[] {
  const raw = String(m.name ?? '').trim();
  const strength = String((m as any).strength ?? '').trim();

  const candidates: string[] = [];
  if (raw) candidates.push(raw);

  // If strength exists and isn't already embedded in name, try appending it.
  if (strength && raw && !raw.toLowerCase().includes(strength.toLowerCase())) {
    candidates.push(`${raw} ${strength}`.trim());
  }

  // Try stripping common strength units from the name.
  if (raw) {
    const stripped = raw
      .replace(/\b\d+(?:\.\d+)?\s*(mg|mcg|g|ml|iu)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (stripped && stripped.toLowerCase() !== raw.toLowerCase()) candidates.push(stripped);
  }

  // De-dupe preserving order.
  return Array.from(new Set(candidates.map((c) => c.trim()).filter(Boolean)));
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function estimateDurationSeconds(distanceMeters: number) {
  // 25 km/h average speed.
  const avgSpeedMps = 25_000 / 3600;
  return Math.max(60, Math.round(distanceMeters / avgSpeedMps));
}

export async function buildCartFromExtraction(input: {
  prescriptionId: string;
  extractionJson: unknown;
  preferredVendorId?: string | null;
  // When true, persist loyalty point usage (used at order time).
  commitPricing?: boolean;
}) {
  const extraction = PrescriptionExtractionSchema.parse(input.extractionJson);

  const db = getDb();
  await ensureVendorSeed(db);

  const presSnap = await db.collection(collections.prescriptions).doc(input.prescriptionId).get();
  const pres = presSnap.exists ? (presSnap.data() as any) : null;
  const customerId = pres?.customerId ? String(pres.customerId) : null;

  const vendors = DEFAULT_VENDOR_IDS as unknown as VendorId[];
  const vendorSnaps = await Promise.all(vendors.map((v) => db.collection(collections.vendors).doc(String(v)).get()));
  const vendorById = new Map<string, any>(vendorSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()] as const));

  const meds = extraction.medications;
  const refs = meds.flatMap((m) => {
    const names = candidateInventoryNames(m as any);
    return vendors.flatMap((v) => names.map((n) => db.collection(collections.vendorInventory).doc(inventoryDocId(String(v), n))));
  });
  const invSnaps = (await (db as any).getAll(...refs)) as Array<any>;

  const invByKey = new Map<string, any>();
  for (const s of invSnaps) {
    if (s?.exists) invByKey.set(String(s.id), s.data());
  }

  function getInv(vendorId: string, med: MedicationExtracted) {
    const names = candidateInventoryNames(med as any);
    for (const n of names) {
      const hit = invByKey.get(inventoryDocId(vendorId, n));
      if (hit) return hit;
    }
    return null;
  }

  const perVendorTotalIfAll: Record<string, number> = {};
  const perVendorSubtotalIfAll: Record<string, number> = {};
  const perVendorDeliveryFee: Record<string, number> = {};
  for (const v of vendors) {
    const vendor = vendorById.get(String(v));
    const deliveryFee = Number(vendor?.baseDeliveryFee ?? 0);
    let subtotal = 0;
    let ok = true;
    for (const m of meds) {
      const qty = m.quantity ?? 1;
      const inv = getInv(String(v), m as any);
      if (!inv || Number(inv.stockQty ?? 0) < qty) {
        ok = false;
        break;
      }
      subtotal += Number(inv.unitPrice ?? 0) * qty;
    }
    perVendorDeliveryFee[String(v)] = deliveryFee;
    perVendorSubtotalIfAll[String(v)] = subtotal;
    perVendorTotalIfAll[String(v)] = ok ? subtotal + deliveryFee : Number.POSITIVE_INFINITY;
  }

  const bestSingleVendor = vendors.reduce(
    (best, v) => (perVendorTotalIfAll[String(v)] < perVendorTotalIfAll[String(best)] ? v : best),
    vendors[0]
  );

  const preferred = input.preferredVendorId ? String(input.preferredVendorId) : null;
  const preferredIsValid = preferred && vendors.map(String).includes(preferred);
  const preferredIsAvailable = preferredIsValid && Number.isFinite(perVendorTotalIfAll[preferred]);

  // Split plan: pick cheapest available vendor per medication.
  const splitItems = meds.map((m) => {
    const qty = m.quantity ?? 1;
    const options = vendors
      .map((v) => {
        const inv = getInv(String(v), m as any);
        const stockQty = Number(inv?.stockQty ?? 0);
        const unitPrice = Number(inv?.unitPrice ?? 0);
        const available = Boolean(inv) && stockQty >= qty;
        return { vendor: String(v), available, stockQty, unitPrice };
      })
      .filter((o) => o.available);

    const best = options.reduce((b, cur) => (!b || cur.unitPrice < b.unitPrice ? cur : b), null as any);
    return { med: m, chosen: best };
  });

  const splitVendorsUsed = Array.from(
    new Set(splitItems.map((x) => x.chosen?.vendor).filter((v): v is string => Boolean(v)))
  );

  const splitSubtotalByVendor: Record<string, number> = {};
  for (const v of splitVendorsUsed) splitSubtotalByVendor[v] = 0;
  let splitOk = true;
  for (const si of splitItems) {
    if (!si.chosen) {
      splitOk = false;
      continue;
    }
    const qty = si.med.quantity ?? 1;
    splitSubtotalByVendor[si.chosen.vendor] += si.chosen.unitPrice * qty;
  }

  const splitDeliveryFee = splitVendorsUsed.reduce((acc, v) => acc + Number(vendorById.get(v)?.baseDeliveryFee ?? 0), 0);
  const splitSubtotal = Object.values(splitSubtotalByVendor).reduce((a, b) => a + b, 0);
  const splitTotal = splitOk ? splitSubtotal + splitDeliveryFee : Number.POSITIVE_INFINITY;

  const useSplit = !preferredIsAvailable && splitTotal < perVendorTotalIfAll[String(bestSingleVendor)];

  const chosenVendorsUsed = preferredIsAvailable
    ? [preferred as string]
    : useSplit
      ? splitVendorsUsed
      : [String(bestSingleVendor)];

  const currency = 'INR';

  const items = meds.map((m) => {
    const qty = m.quantity ?? 1;
    const vendorId = preferredIsAvailable
      ? (preferred as string)
      : useSplit
        ? splitItems.find((x) => x.med === m)?.chosen?.vendor
        : String(bestSingleVendor);
    const inv = vendorId ? getInv(String(vendorId), m as any) : null;
    const stockQty = inv ? Number(inv.stockQty ?? 0) : 0;
    const unitPrice = inv ? Number(inv.unitPrice ?? 0) : null;
    const available = Boolean(inv) && stockQty >= qty;

    return {
      name: m.name,
      strength: m.strength ?? null,
      form: m.form ?? null,
      dosage: m.dosage ?? null,
      frequency: m.frequency ?? null,
      durationDays: m.durationDays ?? null,
      quantity: m.quantity ?? null,
      instructions: m.specialInstructions ?? null,
      vendor: vendorId ?? null,
      stockQty,
      available,
      unitPrice
    };
  });

  const baseSubtotal = items.reduce((acc, it: any) => acc + (it.available && it.unitPrice ? Number(it.unitPrice) * Number(it.quantity ?? 1) : 0), 0);
  const deliveryFee = chosenVendorsUsed.reduce((acc, v) => acc + Number(vendorById.get(v)?.baseDeliveryFee ?? 0), 0);

  // Delivery estimate (mocked but consistent)
  const customerLocation = { lat: 19.076, lng: 72.8777 };
  const perVendorDeliveryAll = (vendors as unknown as string[]).map((v) => {
    const vendor = vendorById.get(String(v));
    const loc = vendor?.location ?? { lat: 19.076, lng: 72.8777 };
    const dist = haversineMeters(loc, customerLocation);
    const dur = estimateDurationSeconds(dist);
    return {
      vendor: String(v),
      distanceKm: Math.round((dist / 1000) * 100) / 100,
      etaMinutes: Math.round((dur / 60) * 10) / 10
    };
  });

  const etaByVendor: Record<string, number> = {};
  for (const d of perVendorDeliveryAll) etaByVendor[d.vendor] = d.etaMinutes;

  const perVendorDeliveryChosen = chosenVendorsUsed
    .map((v) => perVendorDeliveryAll.find((d) => d.vendor === v))
    .filter(Boolean) as Array<{ vendor: string; distanceKm: number; etaMinutes: number }>;

  const overallEtaMinutes = perVendorDeliveryChosen.length
    ? Math.max(...perVendorDeliveryChosen.map((d) => d.etaMinutes))
    : 0;
  const now = new Date();
  const windowStart = new Date(now.getTime() + overallEtaMinutes * 60_000);
  const windowEnd = new Date(windowStart.getTime() + 20 * 60_000);

  const pricing = await applyDynamicPricing({
    customerId,
    vendorIds: chosenVendorsUsed,
    currency,
    baseSubtotal,
    deliveryFee,
    now,
    commit: Boolean(input.commitPricing)
  });

  // Pathway integration: compute per-vendor totals via `/quote` (real-time totals) when configured.
  const vendorIdsForCompare = vendors.map(String);
  const totalsByVendorEntries = await Promise.all(
    vendorIdsForCompare.map(async (vendorId) => {
      const localTotal = perVendorTotalIfAll[vendorId];
      if (!Number.isFinite(localTotal)) return [vendorId, Number.POSITIVE_INFINITY] as const;

      const quoted = await quoteViaPathway({
        selectedVendor: vendorId,
        subtotal: perVendorSubtotalIfAll[vendorId] ?? 0,
        deliveryFee: perVendorDeliveryFee[vendorId] ?? 0,
        currency
      });

      return [vendorId, Number.isFinite(quoted.total) ? quoted.total : localTotal] as const;
    })
  );

  const totalsByVendor: Record<string, number> = {
    'site-a': totalsByVendorEntries.find((e) => e[0] === 'site-a')?.[1] ?? perVendorTotalIfAll['site-a'],
    'site-b': totalsByVendorEntries.find((e) => e[0] === 'site-b')?.[1] ?? perVendorTotalIfAll['site-b'],
    'site-c': totalsByVendorEntries.find((e) => e[0] === 'site-c')?.[1] ?? perVendorTotalIfAll['site-c']
  };

  // For the selected cart, also apply Pathway quote (single-vendor only) to reflect real-time totals.
  const selectedVendorForQuote = chosenVendorsUsed.length === 1 ? String(chosenVendorsUsed[0]) : null;
  const selectedQuote = selectedVendorForQuote
    ? await quoteViaPathway({
        selectedVendor: selectedVendorForQuote,
        subtotal: pricing.subtotalAfterDiscounts,
        deliveryFee: pricing.deliveryFee,
        currency
      })
    : null;

  const finalDeliveryFee = selectedQuote?.source === 'pathway' ? selectedQuote.deliveryFee : pricing.deliveryFee;
  const finalTotal = selectedQuote?.source === 'pathway' ? selectedQuote.total : pricing.total;
  const finalSource = selectedQuote?.source === 'pathway' ? 'pathway' : pricing.source;

  const cartRef = db.collection(collections.carts).doc(input.prescriptionId);
  const payload = {
    createdAt: Timestamp.now(),
    prescriptionId: input.prescriptionId,
    status: 'CONFIRMED',
    items,
    vendor: preferredIsAvailable ? (preferred as string) : useSplit ? 'multi' : String(bestSingleVendor),
    preferredVendorId: preferred ?? null,
    vendorsUsed: chosenVendorsUsed,
    pricing: {
      currency: pricing.currency,
      baseSubtotal: pricing.baseSubtotal,
      subtotal: pricing.subtotalAfterDiscounts,
      discounts: pricing.discounts,
      deliveryFee: finalDeliveryFee,
      total: finalTotal,
      loyaltyPointsUsed: pricing.loyaltyPointsUsed,
      source: finalSource
    },
    delivery: {
      etaMinutes: overallEtaMinutes,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      perVendor: perVendorDeliveryChosen,
      etaByVendor
    },
    totalsByVendor
  };

  await cartRef.set(payload, { merge: true });

  return { id: cartRef.id, ...payload };
}
