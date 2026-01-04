import { Timestamp, getDb } from '../db/firestore.js';
import { collections } from '../db/collections.js';

export type DiscountLine = {
  code: string;
  label: string;
  amount: number;
};

export type PricingBreakdown = {
  currency: string;
  baseSubtotal: number;
  discounts: DiscountLine[];
  subtotalAfterDiscounts: number;
  deliveryFee: number;
  total: number;
  loyaltyPointsUsed: number;
  source: string;
};

export type PricingContext = {
  customerId: string | null;
  vendorIds: string[];
  currency: string;
  baseSubtotal: number;
  deliveryFee: number;
  now: Date;
  // If true, persist loyalty point deductions to Firestore.
  // Use false for previews/simulations.
  commit?: boolean;
};

function clampMoney(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100) / 100);
}

function percentDiscount(amount: number, pct: number) {
  const p = Math.max(0, Math.min(100, pct));
  return clampMoney((amount * p) / 100);
}

export async function applyDynamicPricing(input: PricingContext): Promise<PricingBreakdown> {
  const db = getDb();

  const customerId = input.customerId;
  const customerSnap = customerId ? await db.collection(collections.customers).doc(customerId).get() : null;
  const customer = customerSnap?.exists ? (customerSnap.data() as any) : null;

  const loyaltyPoints = typeof customer?.loyaltyPoints === 'number' ? Math.max(0, Math.floor(customer.loyaltyPoints)) : 0;
  const insurancePct = typeof customer?.insuranceCoveragePct === 'number' ? Math.max(0, Math.min(100, customer.insuranceCoveragePct)) : 0;

  // Vendor rules (take the "best" discount across involved vendors).
  const vendorRuleSnaps = await Promise.all(
    input.vendorIds.map(async (v) => db.collection(collections.vendorPricingRules).doc(String(v)).get())
  );
  const vendorRules = vendorRuleSnaps.map((s) => (s.exists ? (s.data() as any) : null));

  const hour = input.now.getHours();

  const offPeakCandidates = vendorRules
    .map((r) => {
      if (!r) return null;
      const start = typeof r.offPeakStartHour === 'number' ? r.offPeakStartHour : 22;
      const end = typeof r.offPeakEndHour === 'number' ? r.offPeakEndHour : 6;
      const pct = typeof r.offPeakPercent === 'number' ? r.offPeakPercent : 0;

      const inWindow = start < end ? hour >= start && hour < end : hour >= start || hour < end;
      return inWindow ? pct : 0;
    })
    .filter((n): n is number => typeof n === 'number');

  const offPeakPercent = offPeakCandidates.length ? Math.max(...offPeakCandidates) : 0;

  const bulkCandidates = vendorRules
    .map((r) => {
      if (!r) return null;
      const minSubtotal = typeof r.bulkMinSubtotal === 'number' ? r.bulkMinSubtotal : 0;
      const pct = typeof r.bulkPercent === 'number' ? r.bulkPercent : 0;
      return input.baseSubtotal >= minSubtotal ? pct : 0;
    })
    .filter((n): n is number => typeof n === 'number');

  const bulkPercent = bulkCandidates.length ? Math.max(...bulkCandidates) : 0;

  const promoCandidates = vendorRules
    .flatMap((r) => (Array.isArray(r?.promoCodes) ? r.promoCodes : []))
    .filter((p: any) => p && p.active !== false)
    .map((p: any) => {
      const pct = typeof p.percent === 'number' ? p.percent : 0;
      const code = String(p.code ?? 'PROMO');
      return { pct, code };
    });

  const bestPromo = promoCandidates.reduce(
    (best: { pct: number; code: string } | null, cur) => (!best || cur.pct > best.pct ? cur : best),
    null
  );

  const discounts: DiscountLine[] = [];

  let runningSubtotal = clampMoney(input.baseSubtotal);

  if (offPeakPercent > 0) {
    const amt = percentDiscount(runningSubtotal, offPeakPercent);
    if (amt > 0) {
      discounts.push({ code: 'OFF_PEAK', label: `Off-peak discount (${offPeakPercent}%)`, amount: amt });
      runningSubtotal = clampMoney(runningSubtotal - amt);
    }
  }

  if (bulkPercent > 0) {
    const amt = percentDiscount(runningSubtotal, bulkPercent);
    if (amt > 0) {
      discounts.push({ code: 'BULK', label: `Bulk discount (${bulkPercent}%)`, amount: amt });
      runningSubtotal = clampMoney(runningSubtotal - amt);
    }
  }

  if (bestPromo && bestPromo.pct > 0) {
    const amt = percentDiscount(runningSubtotal, bestPromo.pct);
    if (amt > 0) {
      discounts.push({ code: `PROMO_${bestPromo.code}`, label: `Promo applied (${bestPromo.code})`, amount: amt });
      runningSubtotal = clampMoney(runningSubtotal - amt);
    }
  }

  if (insurancePct > 0) {
    const amt = percentDiscount(runningSubtotal, insurancePct);
    if (amt > 0) {
      discounts.push({ code: 'INSURANCE', label: `Insurance coverage (${insurancePct}%)`, amount: amt });
      runningSubtotal = clampMoney(runningSubtotal - amt);
    }
  }

  const loyaltyToUse = Math.min(loyaltyPoints, Math.floor(runningSubtotal));
  if (loyaltyToUse > 0) {
    discounts.push({ code: 'LOYALTY', label: 'Loyalty points', amount: clampMoney(loyaltyToUse) });
    runningSubtotal = clampMoney(runningSubtotal - loyaltyToUse);

    if (customerId && input.commit) {
      await db.collection(collections.customers).doc(customerId).set(
        {
          loyaltyPoints: loyaltyPoints - loyaltyToUse,
          updatedAt: Timestamp.now()
        },
        { merge: true }
      );
    }
  }

  const deliveryFee = clampMoney(input.deliveryFee);
  const total = clampMoney(runningSubtotal + deliveryFee);

  return {
    currency: input.currency,
    baseSubtotal: clampMoney(input.baseSubtotal),
    discounts,
    subtotalAfterDiscounts: runningSubtotal,
    deliveryFee,
    total,
    loyaltyPointsUsed: loyaltyToUse,
    source: 'dynamic'
  };
}
