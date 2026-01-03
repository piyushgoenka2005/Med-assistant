import { google } from 'googleapis';
import { env } from '../env.js';
function isConfigured() {
    return Boolean(env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY && env.GOOGLE_CALENDAR_ID);
}
function getPrivateKey() {
    // Common pattern: store with escaped newlines in env
    return (env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
}
export async function createCalendarEvent(input) {
    if (!isConfigured())
        return null;
    const auth = new google.auth.JWT({
        email: env.GOOGLE_CLIENT_EMAIL,
        key: getPrivateKey(),
        scopes: ['https://www.googleapis.com/auth/calendar']
    });
    const calendar = google.calendar({ version: 'v3', auth });
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
    if (!eventId)
        return null;
    return { eventId };
}
