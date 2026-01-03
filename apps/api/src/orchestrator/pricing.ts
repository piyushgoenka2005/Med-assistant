import { env } from '../env.js';
import type { MedicationExtracted } from '@medi/shared';

export type VendorId = 'site-a' | 'site-b' | 'site-c';

export type VendorOffer = {
  vendor: VendorId;
  medicationName: string;
  quantity: number;
  unitPrice: number;
  deliveryFee: number;
  currency: string;
  available: boolean;
  total: number;
};

function apiBaseUrl() {
  // The API server listens on 0.0.0.0; use loopback for Playwright.
  return `http://127.0.0.1:${env.API_PORT}`;
}

async function fetchOfferViaBrowser(vendor: VendorId, medicationName: string, quantity: number): Promise<VendorOffer> {
  // Lazy import so dev can run without Playwright installed.
  const pw = await import('playwright');

  const browserName = (process.env.PLAYWRIGHT_BROWSER ?? 'chromium') as 'chromium' | 'firefox' | 'webkit';
  const browserType = pw[browserName] ?? pw.chromium;
  const browser = await browserType.launch({ headless: true });

  try {
    const page = await browser.newPage();
    const url = `${apiBaseUrl()}/dummy/${vendor}?name=${encodeURIComponent(medicationName)}&qty=${encodeURIComponent(String(quantity))}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const extracted = await page.evaluate(() => {
      const doc = (globalThis as any).document as any;
      const unit = doc?.querySelector?.('[data-unit-price]')?.textContent ?? '';
      const delivery = doc?.querySelector?.('[data-delivery-fee]')?.textContent ?? '';
      const available = doc?.querySelector?.('[data-available]')?.textContent ?? '';
      const total = doc?.querySelector?.('[data-total]')?.textContent ?? '';
      const med = doc?.querySelector?.('[data-med-name]')?.textContent ?? '';
      const currency = doc?.querySelector?.('#result')?.getAttribute?.('data-currency') ?? 'INR';
      return { unit, delivery, available, total, med, currency };
    });

    const unitPrice = Number(extracted.unit);
    const deliveryFee = Number(extracted.delivery);
    const total = Number(extracted.total);

    return {
      vendor,
      medicationName: extracted.med || medicationName,
      quantity,
      unitPrice,
      deliveryFee,
      currency: extracted.currency,
      available: extracted.available.trim().toUpperCase() === 'YES',
      total
    };
  } finally {
    await browser.close();
  }
}

async function fetchOfferViaJson(vendor: VendorId, medicationName: string, quantity: number): Promise<VendorOffer> {
  const url = `${apiBaseUrl()}/dummy/${vendor}?name=${encodeURIComponent(medicationName)}&qty=${encodeURIComponent(String(quantity))}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Dummy vendor ${vendor} failed: ${res.status}`);
  const data = (await res.json()) as any;
  return {
    vendor,
    medicationName: String(data.name ?? medicationName),
    quantity,
    unitPrice: Number(data.unitPrice),
    deliveryFee: Number(data.deliveryFee),
    currency: String(data.currency ?? 'INR'),
    available: Boolean(data.available),
    total: Number(data.total)
  };
}

export async function getBestOffersForMedications(input: {
  medications: MedicationExtracted[];
}): Promise<{
  selectedVendor: VendorId;
  offers: VendorOffer[];
  currency: string;
  totalsByVendor: Record<VendorId, number>;
}> {
  const meds = input.medications;
  const vendors: VendorId[] = ['site-a', 'site-b', 'site-c'];

  // Compute per-vendor totals; include delivery fee once per vendor.
  const totalsByVendor: Record<VendorId, number> = { 'site-a': 0, 'site-b': 0, 'site-c': 0 };
  const offers: VendorOffer[] = [];

  for (const med of meds) {
    const name = med.name;
    const quantity = med.quantity ?? 1;

    const perVendor = await Promise.all(
      vendors.map(async (vendor) => {
        try {
          return await fetchOfferViaBrowser(vendor, name, quantity);
        } catch {
          // Fallback keeps the system working even if Playwright/browsers aren't installed.
          return await fetchOfferViaJson(vendor, name, quantity);
        }
      })
    );

    for (const offer of perVendor) {
      offers.push(offer);
      if (offer.available) {
        // total already includes delivery fee; we'll handle delivery only once by re-adding later.
        totalsByVendor[offer.vendor] += offer.unitPrice * offer.quantity;
      } else {
        totalsByVendor[offer.vendor] += Number.POSITIVE_INFINITY;
      }
    }
  }

  // Add delivery fee once per vendor using the first offer per vendor (stable for our dummy sites).
  for (const vendor of vendors) {
    const first = offers.find((o) => o.vendor === vendor);
    if (first) totalsByVendor[vendor] += first.deliveryFee;
  }

  const selectedVendor = vendors.reduce((best, vendor) =>
    totalsByVendor[vendor] < totalsByVendor[best] ? vendor : best
  , vendors[0]);

  const currency = offers.find((o) => o.vendor === selectedVendor)?.currency ?? 'INR';

  return { selectedVendor, offers, currency, totalsByVendor };
}
