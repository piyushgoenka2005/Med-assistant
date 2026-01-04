import { createCalendarEvent } from '../integrations/googleCalendar.js';
import { getDb, Timestamp } from '../db/firestore.js';
import { collections } from '../db/collections.js';
import { PrescriptionExtractionSchema } from '@medi/shared';

function formatMedicationShort(med: { name: string; strength?: string }) {
  return `${med.name}${med.strength ? ` ${med.strength}` : ''}`.trim();
}

function buildCalendarSummary(meds: Array<{ name: string; strength?: string }>) {
  if (!meds.length) return 'Take medication';

  const items = meds.map(formatMedicationShort);

  const prefix = 'Take: ';
  const maxLen = 70;
  let out: string[] = [];
  let curLen = prefix.length;

  for (const item of items) {
    const addLen = (out.length ? 2 : 0) + item.length;
    if (curLen + addLen > maxLen) break;
    out.push(item);
    curLen += addLen;
  }

  const remaining = items.length - out.length;
  return `${prefix}${out.join(', ')}${remaining > 0 ? ` +${remaining} more` : ''}`.trim();
}

function buildCalendarDescription(meds: Array<{ name: string; strength?: string; form?: string; dosage?: string; frequency?: string; durationDays?: number; specialInstructions?: string }>) {
  if (!meds.length) return undefined;
  const lines = meds.map((m) => {
    const parts = [
      m.name,
      m.strength,
      m.form,
      m.dosage,
      m.frequency,
      typeof m.durationDays === 'number' ? `${m.durationDays} days` : undefined,
      m.specialInstructions
    ].filter(Boolean);
    return `- ${parts.join(' ')}`;
  });
  return lines.join('\n');
}

export async function scheduleDefaultReminders(input: {
  prescriptionId: string;
  cartId: string;
}) {
  const now = Date.now();

  const db = getDb();

  const extractionSnap = await db.collection(collections.extractions).doc(input.prescriptionId).get();
  const extraction = extractionSnap.data();
  const parsedExtraction = PrescriptionExtractionSchema.safeParse(extraction?.rawJson);
  const meds = parsedExtraction.success ? parsedExtraction.data.medications : [];

  // Create Google Calendar event showing only meds to take (required)
  const start1 = new Date(now + 60_000);
  const end1 = new Date(start1.getTime() + 10 * 60_000);
  const calendarReminder = await createCalendarEvent({
    summary: buildCalendarSummary(meds),
    description: buildCalendarDescription(meds),
    start: start1,
    end: end1
  });

  const start2 = new Date(now + 120_000);

  const reminders = [
    {
      dueAt: Timestamp.fromDate(start1),
      channel: 'PUSH',
      status: 'SCHEDULED',
      attempts: 0,
      lastError: null,
      payload: {
        type: 'MEDICATION_REMINDER',
        prescriptionId: input.prescriptionId,
        cartId: input.cartId,
        googleCalendarEventId: calendarReminder.eventId
      }
    },
    {
      dueAt: Timestamp.fromDate(start2),
      channel: 'VOICE',
      status: 'SCHEDULED',
      attempts: 0,
      lastError: null,
      payload: {
        type: 'SYMPTOM_CHECKIN',
        prescriptionId: input.prescriptionId,
        googleCalendarEventId: null
      }
    }
  ];

  for (const r of reminders) {
    await db.collection(collections.reminders).doc().set({
      createdAt: Timestamp.now(),
      ...r
    });
  }
}
