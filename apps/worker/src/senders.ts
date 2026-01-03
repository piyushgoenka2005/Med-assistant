export type Reminder = {
  id?: string;
  channel?: string;
  payload?: unknown;
};

export async function sendReminder(reminder: Reminder) {
  // MVP: log only.
  // This is where you'd call ElevenLabs for VOICE and your notification provider for PUSH/SMS/EMAIL.
  console.log('[reminder]', reminder.channel, reminder.payload);
}
