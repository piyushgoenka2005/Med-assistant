import dotenv from 'dotenv';
import { sendReminder } from './senders.js';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// When run via `npm -w`, the CWD is the package folder (apps/worker).
// Load the repo-root `.env` so Firebase creds are picked up.
dotenv.config({
  path: process.env.ENV_FILE ?? path.join(process.env.INIT_CWD ?? process.cwd(), '.env')
});

function getPrivateKey() {
  return (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
}

function getProjectId(): string | undefined {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credsPath) {
    try {
      const raw = readFileSync(credsPath, 'utf8');
      const parsed = JSON.parse(raw) as { project_id?: string };
      if (parsed.project_id) return parsed.project_id;
    } catch {
      // ignore: we'll fall back to env vars / ADC detection
    }
  }
  return (
    process.env.FIREBASE_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    undefined
  );
}

function db() {
  if (getApps().length === 0) {
    const projectId = getProjectId();
    const hasServiceAccountFile = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);

    // If a service-account JSON file is configured, prefer ADC (it reads that file)
    // and avoid accidentally using placeholder Option-B values.
    if (hasServiceAccountFile) {
      initializeApp({ credential: applicationDefault(), projectId });
      return getFirestore();
    }

    const projectIdInline = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (projectIdInline && clientEmail && privateKey) {
      initializeApp({
        credential: cert({ projectId: projectIdInline, clientEmail, privateKey: getPrivateKey() }),
        projectId: projectIdInline
      });
    } else {
      initializeApp({ credential: applicationDefault(), projectId });
    }
  }
  return getFirestore();
}

const REMINDERS = 'reminders';

let firebaseWarningShown = false;

async function tick() {
  let snap;
  try {
    const now = Timestamp.now();
    snap = await db()
      .collection(REMINDERS)
      .where('status', '==', 'SCHEDULED')
      .where('dueAt', '<=', now)
      .limit(25)
      .get();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!firebaseWarningShown) {
      firebaseWarningShown = true;
      console.error(
        '[worker] Firebase not configured. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.\n',
        message
      );
    }
    return;
  }

  const due = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  for (const reminder of due) {
    try {
      const ref = db().collection(REMINDERS).doc(reminder.id);
      await ref.update({ attempts: (reminder.attempts ?? 0) + 1 });

      await sendReminder(reminder);

      await ref.update({ status: 'SENT', lastError: null });
    } catch (err) {
      await db()
        .collection(REMINDERS)
        .doc(reminder.id)
        .update({ status: 'FAILED', lastError: err instanceof Error ? err.message : 'Unknown error' });
    }
  }
}

setInterval(() => {
  void tick();
}, 10_000);

void tick();
