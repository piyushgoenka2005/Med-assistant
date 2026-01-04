import { getDb, Timestamp } from '../db/firestore.js';
import { collections } from '../db/collections.js';

export const DEFAULT_VENDOR_IDS = ['site-a', 'site-b', 'site-c'] as const;
export type DefaultVendorId = (typeof DEFAULT_VENDOR_IDS)[number];

export function slugifyMedicationName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function inventoryDocId(vendorId: string, medName: string) {
  return `${vendorId}__${slugifyMedicationName(medName)}`;
}

export async function ensureVendorSeed(db = getDb()) {
  const vendorsRef = db.collection(collections.vendors);
  const inventoryRef = db.collection(collections.vendorInventory);

  for (const id of DEFAULT_VENDOR_IDS) {
    const ref = vendorsRef.doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        id,
        name: id.toUpperCase(),
        active: true,
        currency: 'INR',
        baseDeliveryFee: id === 'site-c' ? 50 : 35,
        location:
          id === 'site-a'
            ? { lat: 19.076, lng: 72.8777 }
            : id === 'site-b'
              ? { lat: 18.5204, lng: 73.8567 }
              : { lat: 28.6139, lng: 77.209 },
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
    }

    const pricingRef = db.collection(collections.vendorPricingRules).doc(id);
    const pricingSnap = await pricingRef.get();
    if (!pricingSnap.exists) {
      await pricingRef.set({
        vendorId: id,
        offPeakStartHour: 22,
        offPeakEndHour: 6,
        offPeakPercent: id === 'site-b' ? 6 : 4,
        bulkMinSubtotal: 499,
        bulkPercent: id === 'site-a' ? 5 : 3,
        promoCodes: [{ code: `${id.toUpperCase()}10`, percent: 10, active: id === 'site-c' }],
        updatedAt: Timestamp.now()
      });
    }

    // Seed a small starter inventory so the app is usable out-of-the-box.
    // Only create docs that don't exist yet (do not overwrite vendor changes).
    const starter = [
      // Generic demo items
      { name: 'Cetirizine 10mg', stockQty: 80, unitPrice: id === 'site-a' ? 12 : id === 'site-b' ? 11 : 13 },
      { name: 'Metformin 500mg', stockQty: 60, unitPrice: id === 'site-a' ? 32 : id === 'site-b' ? 30 : 34 },
      { name: 'Atorvastatin 10mg', stockQty: 40, unitPrice: id === 'site-a' ? 75 : id === 'site-b' ? 72 : 79 },
      { name: 'Omeprazole 20mg', stockQty: 50, unitPrice: id === 'site-a' ? 48 : id === 'site-b' ? 45 : 52 },

      // Common extracted meds (match UI screenshots / typical prescriptions)
      { name: 'Augmentin 625 mg', stockQty: 30, unitPrice: id === 'site-a' ? 220 : id === 'site-b' ? 210 : 235 },
      { name: 'Enzflam', stockQty: 50, unitPrice: id === 'site-a' ? 42 : id === 'site-b' ? 39 : 45 },
      { name: 'Paracetamol 500 mg', stockQty: 120, unitPrice: id === 'site-a' ? 18 : id === 'site-b' ? 17 : 19 },
      { name: 'Pan-D 40 mg', stockQty: 40, unitPrice: id === 'site-a' ? 78 : id === 'site-b' ? 74 : 82 },
      { name: 'Hexigel gum paint', stockQty: 25, unitPrice: id === 'site-a' ? 95 : id === 'site-b' ? 92 : 99 }
    ];

    const docs = starter.map((it) => inventoryRef.doc(inventoryDocId(id, it.name)));
    const snaps = (await (db as any).getAll(...docs)) as Array<any>;
    const batch = db.batch();
    let writes = 0;
    for (let i = 0; i < starter.length; i++) {
      const it = starter[i];
      const ref = docs[i];
      const snap = snaps[i];
      if (snap?.exists) continue;
      batch.set(ref, {
        vendorId: id,
        name: it.name,
        nameLower: it.name.trim().toLowerCase(),
        stockQty: it.stockQty,
        unitPrice: it.unitPrice,
        currency: 'INR',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
      writes += 1;
    }
    if (writes > 0) await batch.commit();
  }
}
