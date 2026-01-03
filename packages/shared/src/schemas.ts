import { z } from 'zod';

export const MedicationExtractedSchema = z.object({
  name: z.string().min(1),
  strength: z.string().optional(),
  form: z.string().optional(),
  dosage: z.string().optional(),
  frequency: z.string().optional(),
  durationDays: z.number().int().positive().optional(),
  specialInstructions: z.string().optional(),
  quantity: z.number().int().positive().optional()
});

export const PrescriptionExtractionSchema = z.object({
  prescriberName: z.string().optional(),
  patientName: z.string().optional(),
  issuedDate: z.string().optional(),
  medications: z.array(MedicationExtractedSchema),
  notes: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
});

export type MedicationExtracted = z.infer<typeof MedicationExtractedSchema>;
export type PrescriptionExtraction = z.infer<typeof PrescriptionExtractionSchema>;
