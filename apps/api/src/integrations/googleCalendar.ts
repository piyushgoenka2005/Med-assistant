import { google } from 'googleapis';
import { env } from '../env.js';
import crypto from 'node:crypto';

function isConfigured() {
  return Boolean(env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY && env.GOOGLE_CALENDAR_ID);
}

function getPrivateKey() {
  // Common pattern: store with escaped newlines in env
  return (env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
}

function validatePrivateKeyOrThrow() {
  const key = getPrivateKey();
  try {
    // Forces OpenSSL to parse the PEM; throws ERR_OSSL_* if invalid.
    crypto.createPrivateKey(key);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      'Invalid GOOGLE_PRIVATE_KEY for Google Calendar. ' +
        'Use the full service-account private_key PEM (BEGIN/END PRIVATE KEY) and ensure the calendar is shared ' +
        `with the service account email. Details: ${msg}`
    );
  }
}

export async function createCalendarEvent(input: {
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  recurrence?: string[];
}): Promise<{ eventId: string }> {
  if (!isConfigured()) {
    throw new Error(
      'Google Calendar is not configured. Set GOOGLE_CALENDAR_ID and provide service account credentials via ' +
        'GOOGLE_APPLICATION_CREDENTIALS (recommended) or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY.'
    );
  }

  validatePrivateKeyOrThrow();

  const auth = new google.auth.JWT({
    email: env.GOOGLE_CLIENT_EMAIL,
    key: getPrivateKey(),
    scopes: ['https://www.googleapis.com/auth/calendar']
  });

  const calendar = google.calendar({ version: 'v3', auth });

  try {
    const res = await calendar.events.insert({
      calendarId: env.GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.start.toISOString() },
        end: { dateTime: input.end.toISOString() },
        recurrence: input.recurrence
      }
    });

    const eventId = res.data.id;
    if (!eventId) {
      throw new Error('Google Calendar event insert returned no event id.');
    }
    return { eventId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      'Failed to create Google Calendar event. Ensure Calendar API is enabled for the project and the calendar ' +
        'is shared with the service account email (with “Make changes to events”). ' +
        `Details: ${msg}`
    );
  }
}
