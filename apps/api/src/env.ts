import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';

// In npm workspaces, dev servers often run with CWD under apps/*.
// Load the repo-root .env explicitly so API/worker behave consistently.
const initCwd = process.env.INIT_CWD;
const rootDir = initCwd ? initCwd : path.resolve(process.cwd(), '..', '..');

// Developer convenience: if a firebase-adminsdk JSON exists in the repo root and
// GOOGLE_APPLICATION_CREDENTIALS isn't set, point ADC at it.
// This avoids slow/blocked ADC discovery (metadata server checks) on Windows.
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    const entries = fs.readdirSync(rootDir);
    const candidate = entries.find((name) => /firebase-adminsdk.*\.json$/i.test(name));
    if (candidate) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(rootDir, candidate);
    }
  } catch {
    // ignore
  }
}

// Avoid writing uploads under OneDrive on Windows (can cause long stalls/ECONNRESET).
// If the user didn't configure UPLOAD_DIR, default to LOCALAPPDATA.
if (!process.env.UPLOAD_DIR && process.platform === 'win32') {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    process.env.UPLOAD_DIR = path.join(localAppData, 'medi-api-uploads');
  }
}
dotenv.config({ path: path.join(rootDir, '.env') });

// Developer convenience: reuse the service account JSON for Google Calendar auth.
// If GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY are not set explicitly, derive them
// from GOOGLE_APPLICATION_CREDENTIALS when possible.
if ((!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    const p = String(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      const json = JSON.parse(raw) as any;
      if (!process.env.GOOGLE_CLIENT_EMAIL && typeof json?.client_email === 'string') {
        process.env.GOOGLE_CLIENT_EMAIL = json.client_email;
      }
      if (!process.env.GOOGLE_PRIVATE_KEY && typeof json?.private_key === 'string') {
        process.env.GOOGLE_PRIVATE_KEY = json.private_key;
      }
    }
  } catch {
    // ignore
  }
}

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  API_PORT: z.coerce.number().default(4000),
  UPLOAD_DIR: z.string().default('./storage'),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  OCR_SPACE_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('nvidia/nemotron-nano-9b-v2:free'),
  OPENROUTER_SITE_URL: z.string().optional(),
  OPENROUTER_APP_NAME: z.string().optional(),
  PHARMACY_BASE_URL: z.string().optional(),
  PHARMACY_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  GOOGLE_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  PATHWAY_BASE_URL: z.string().optional(),
  
  // Routing / distance estimates
  ROUTING_PROVIDER: z.enum(['mock', 'google', 'mapbox']).optional().default('mock'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  MAPBOX_ACCESS_TOKEN: z.string().optional(),

});

export const env = EnvSchema.parse(process.env);
