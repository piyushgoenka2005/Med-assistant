import { env } from '../env.js';
export async function quoteViaPathway(input) {
    if (!env.PATHWAY_BASE_URL) {
        return {
            total: input.subtotal + input.deliveryFee,
            deliveryFee: input.deliveryFee,
            currency: input.currency,
            source: 'local'
        };
    }
    const res = await fetch(`${env.PATHWAY_BASE_URL.replace(/\/$/, '')}/quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input)
    });
    if (!res.ok) {
        return {
            total: input.subtotal + input.deliveryFee,
            deliveryFee: input.deliveryFee,
            currency: input.currency,
            source: 'local'
        };
    }
    const data = (await res.json());
    return {
        total: Number(data.total ?? input.subtotal + input.deliveryFee),
        deliveryFee: Number(data.deliveryFee ?? input.deliveryFee),
        currency: String(data.currency ?? input.currency),
        source: 'pathway'
    };
}
