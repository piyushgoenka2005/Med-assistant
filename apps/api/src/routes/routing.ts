import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';

const EstimateBody = z.object({
  origin: z.object({ lat: z.number(), lng: z.number() }),
  destination: z.object({ lat: z.number(), lng: z.number() }),
  mode: z.enum(['driving', 'walking', 'bicycling', 'transit']).optional().default('driving'),
  departureTime: z.number().int().positive().optional()
});

type Estimate = {
  distanceMeters: number;
  durationSeconds: number;
  provider: 'google' | 'mapbox' | 'mock';
};

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

async function estimateViaGoogle(input: z.infer<typeof EstimateBody>): Promise<Estimate> {
  const key = env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set');

  const origins = `${input.origin.lat},${input.origin.lng}`;
  const destinations = `${input.destination.lat},${input.destination.lng}`;
  const departure_time = input.departureTime ? String(Math.floor(input.departureTime / 1000)) : 'now';

  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', origins);
  url.searchParams.set('destinations', destinations);
  url.searchParams.set('mode', input.mode);
  url.searchParams.set('departure_time', departure_time);
  url.searchParams.set('key', key);

  const res = await fetch(url);
  const json = (await res.json()) as any;
  const el = json?.rows?.[0]?.elements?.[0];
  if (!el || el.status !== 'OK') {
    throw new Error(`Google routing failed: ${el?.status ?? json?.status ?? res.status}`);
  }

  const distanceMeters = Number(el.distance?.value ?? 0);
  const durationSeconds = Number(el.duration_in_traffic?.value ?? el.duration?.value ?? 0);

  if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds) || distanceMeters <= 0 || durationSeconds <= 0) {
    throw new Error('Google routing returned invalid distance/duration');
  }

  return { distanceMeters, durationSeconds, provider: 'google' };
}

async function estimateViaMapbox(input: z.infer<typeof EstimateBody>): Promise<Estimate> {
  const token = env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error('MAPBOX_ACCESS_TOKEN is not set');

  const profile = input.mode === 'driving' ? 'driving-traffic' : input.mode;
  const coords = `${input.origin.lng},${input.origin.lat};${input.destination.lng},${input.destination.lat}`;

  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('overview', 'false');

  const res = await fetch(url);
  const json = (await res.json()) as any;
  const route = json?.routes?.[0];
  if (!route) throw new Error(`Mapbox routing failed: ${json?.message ?? res.status}`);

  const distanceMeters = Number(route.distance ?? 0);
  const durationSeconds = Number(route.duration ?? 0);
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds) || distanceMeters <= 0 || durationSeconds <= 0) {
    throw new Error('Mapbox routing returned invalid distance/duration');
  }

  return { distanceMeters, durationSeconds, provider: 'mapbox' };
}

async function estimateMock(input: z.infer<typeof EstimateBody>): Promise<Estimate> {
  // Simple, deterministic: haversine distance + 25km/h average speed.
  const distanceMeters = Math.max(100, Math.round(haversineMeters(input.origin, input.destination)));
  const avgSpeedMps = 25_000 / 3600;
  const durationSeconds = Math.max(60, Math.round(distanceMeters / avgSpeedMps));
  return { distanceMeters, durationSeconds, provider: 'mock' };
}

export async function routingRoutes(app: FastifyInstance) {
  app.post('/estimate', async (req, reply) => {
    const body = EstimateBody.parse(req.body);

    const provider = (env.ROUTING_PROVIDER ?? 'mock').toLowerCase();

    try {
      const est =
        provider === 'google'
          ? await estimateViaGoogle(body)
          : provider === 'mapbox'
            ? await estimateViaMapbox(body)
            : await estimateMock(body);

      return reply.send({
        ...est,
        distanceKm: Math.round((est.distanceMeters / 1000) * 100) / 100,
        durationMinutes: Math.round((est.durationSeconds / 60) * 10) / 10
      });
    } catch (e) {
      // Fall back to mock if a provider is misconfigured.
      const msg = e instanceof Error ? e.message : String(e);
      const est = await estimateMock(body);
      return reply.send({
        ...est,
        distanceKm: Math.round((est.distanceMeters / 1000) * 100) / 100,
        durationMinutes: Math.round((est.durationSeconds / 60) * 10) / 10,
        warning: msg
      });
    }
  });
}
