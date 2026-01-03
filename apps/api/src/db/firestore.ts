import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { env } from '../env.js';

function getFirebasePrivateKey() {
  return (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
}

export function getDb() {
  if (getApps().length === 0) {
    // If a service-account JSON path is provided, ADC will use it.
    // Prefer ADC to avoid accidentally using placeholder inline values.
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp({ credential: applicationDefault() });
    } else if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
      initializeApp({
        credential: cert({
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: getFirebasePrivateKey()
        })
      });
    } else {
      // Uses GOOGLE_APPLICATION_CREDENTIALS if set
      initializeApp({ credential: applicationDefault() });
    }
  }
  return getFirestore();
}

export { Timestamp };
