import { createCalendarEvent } from '../integrations/googleCalendar.js';
import { getDb, Timestamp } from '../db/firestore.js';
import { collections } from '../db/collections.js';
export async function scheduleDefaultReminders(input) {
    const now = Date.now();
    const db = getDb();
    // MVP: create Google Calendar events (if configured)
    const start1 = new Date(now + 60_000);
    const end1 = new Date(start1.getTime() + 10 * 60_000);
    const calendarReminder = await createCalendarEvent({
        summary: 'Medication reminder',
        description: `Prescription ${input.prescriptionId}`,
        start: start1,
        end: end1
    });
    const start2 = new Date(now + 120_000);
    const end2 = new Date(start2.getTime() + 10 * 60_000);
    const calendarCheckin = await createCalendarEvent({
        summary: 'Symptom / side-effect check-in',
        description: `Prescription ${input.prescriptionId}`,
        start: start2,
        end: end2
    });
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
                googleCalendarEventId: calendarReminder?.eventId ?? null
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
                googleCalendarEventId: calendarCheckin?.eventId ?? null
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
