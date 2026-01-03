import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

// In npm workspaces, dev servers often run with CWD under apps/*.
// Load the repo-root .env explicitly so API/worker behave consistently.
const initCwd = process.env.INIT_CWD;
const rootDir = initCwd ? initCwd : path.resolve(process.cwd(), '..', '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  API_PORT: z.coerce.number().default(4000),
  UPLOAD_DIR: z.string().default('./storage'),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  OCR_SPACE_API_KEY: z.string().optional(),
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

});

export const env = EnvSchema.parse(process.env);
