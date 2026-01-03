import { z } from 'zod';
export declare const MedicationExtractedSchema: z.ZodObject<{
    name: z.ZodString;
    strength: z.ZodOptional<z.ZodString>;
    form: z.ZodOptional<z.ZodString>;
    dosage: z.ZodOptional<z.ZodString>;
    frequency: z.ZodOptional<z.ZodString>;
    durationDays: z.ZodOptional<z.ZodNumber>;
    specialInstructions: z.ZodOptional<z.ZodString>;
    quantity: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    name: string;
    strength?: string | undefined;
    form?: string | undefined;
    dosage?: string | undefined;
    frequency?: string | undefined;
    durationDays?: number | undefined;
    specialInstructions?: string | undefined;
    quantity?: number | undefined;
}, {
    name: string;
    strength?: string | undefined;
    form?: string | undefined;
    dosage?: string | undefined;
    frequency?: string | undefined;
    durationDays?: number | undefined;
    specialInstructions?: string | undefined;
    quantity?: number | undefined;
}>;
export declare const PrescriptionExtractionSchema: z.ZodObject<{
    prescriberName: z.ZodOptional<z.ZodString>;
    patientName: z.ZodOptional<z.ZodString>;
    issuedDate: z.ZodOptional<z.ZodString>;
    medications: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        strength: z.ZodOptional<z.ZodString>;
        form: z.ZodOptional<z.ZodString>;
        dosage: z.ZodOptional<z.ZodString>;
        frequency: z.ZodOptional<z.ZodString>;
        durationDays: z.ZodOptional<z.ZodNumber>;
        specialInstructions: z.ZodOptional<z.ZodString>;
        quantity: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        strength?: string | undefined;
        form?: string | undefined;
        dosage?: string | undefined;
        frequency?: string | undefined;
        durationDays?: number | undefined;
        specialInstructions?: string | undefined;
        quantity?: number | undefined;
    }, {
        name: string;
        strength?: string | undefined;
        form?: string | undefined;
        dosage?: string | undefined;
        frequency?: string | undefined;
        durationDays?: number | undefined;
        specialInstructions?: string | undefined;
        quantity?: number | undefined;
    }>, "many">;
    notes: z.ZodOptional<z.ZodString>;
    confidence: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    medications: {
        name: string;
        strength?: string | undefined;
        form?: string | undefined;
        dosage?: string | undefined;
        frequency?: string | undefined;
        durationDays?: number | undefined;
        specialInstructions?: string | undefined;
        quantity?: number | undefined;
    }[];
    prescriberName?: string | undefined;
    patientName?: string | undefined;
    issuedDate?: string | undefined;
    notes?: string | undefined;
    confidence?: number | undefined;
}, {
    medications: {
        name: string;
        strength?: string | undefined;
        form?: string | undefined;
        dosage?: string | undefined;
        frequency?: string | undefined;
        durationDays?: number | undefined;
        specialInstructions?: string | undefined;
        quantity?: number | undefined;
    }[];
    prescriberName?: string | undefined;
    patientName?: string | undefined;
    issuedDate?: string | undefined;
    notes?: string | undefined;
    confidence?: number | undefined;
}>;
export type MedicationExtracted = z.infer<typeof MedicationExtractedSchema>;
export type PrescriptionExtraction = z.infer<typeof PrescriptionExtractionSchema>;
