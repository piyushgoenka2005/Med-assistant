import { uploadRoutes } from './uploads.js';
import { prescriptionRoutes } from './prescriptions.js';
import { orderRoutes } from './orders.js';
import { dummySiteRoutes } from './dummySites.js';
export async function registerRoutes(app) {
    await app.register(uploadRoutes, { prefix: '/v1/uploads' });
    await app.register(prescriptionRoutes, { prefix: '/v1/prescriptions' });
    await app.register(orderRoutes, { prefix: '/v1/orders' });
    await app.register(dummySiteRoutes, { prefix: '/dummy' });
}
