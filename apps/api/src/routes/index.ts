import type { FastifyInstance } from 'fastify';
import { uploadRoutes } from './uploads.js';
import { prescriptionRoutes } from './prescriptions.js';
import { orderRoutes } from './orders.js';
import { dummySiteRoutes } from './dummySites.js';
import { routingRoutes } from './routing.js';
import { vendorRoutes } from './vendors.js';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(uploadRoutes, { prefix: '/v1/uploads' });
  await app.register(prescriptionRoutes, { prefix: '/v1/prescriptions' });
  await app.register(orderRoutes, { prefix: '/v1/orders' });
  await app.register(routingRoutes, { prefix: '/v1/routing' });
  await app.register(vendorRoutes, { prefix: '/v1/vendors' });
  await app.register(dummySiteRoutes, { prefix: '/dummy' });
}
