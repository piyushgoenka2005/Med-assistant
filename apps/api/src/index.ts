import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import { env } from './env.js';
import { registerRoutes } from './routes/index.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(sensible);
await app.register(multipart);

await registerRoutes(app);

app.get('/health', async () => ({ ok: true }));
app.get('/v1/health', async () => ({ ok: true }));

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
