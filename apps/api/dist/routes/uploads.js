import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../env.js';
import { orchestrateExtraction } from '../orchestrator/extraction.js';
import { getDb, Timestamp } from '../db/firestore.js';
import { collections } from '../db/collections.js';
import { isAllowedPrescriptionMimeType } from '../tools/fileType.js';
export async function uploadRoutes(app) {
    app.post('/prescription', async (req, reply) => {
        const parts = req.parts();
        let filePart = null;
        const fields = {};
        for await (const part of parts) {
            if (part.type === 'file') {
                // Keep the first file only.
                if (!filePart) {
                    // @fastify/multipart file type matches this shape
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    filePart = part;
                }
                else {
                    // Drain extra files
                    part.file.resume();
                }
            }
            else {
                fields[part.fieldname] = String(part.value ?? '');
            }
        }
        if (!filePart)
            return reply.badRequest('Missing file');
        if (!isAllowedPrescriptionMimeType(filePart.mimetype)) {
            return reply.badRequest('Unsupported file type. Please upload PDF, PNG, or JPEG.');
        }
        await fs.mkdir(env.UPLOAD_DIR, { recursive: true });
        const uploadId = crypto.randomUUID();
        const safeName = filePart.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = path.join(env.UPLOAD_DIR, `${uploadId}-${safeName}`);
        const hash = crypto.createHash('sha256');
        let sizeBytes = 0;
        await new Promise((resolve, reject) => {
            const out = createWriteStream(storagePath);
            filePart.file.on('data', (chunk) => {
                sizeBytes += chunk.length;
                hash.update(chunk);
            });
            filePart.file.on('error', reject);
            out.on('error', reject);
            out.on('finish', () => resolve());
            filePart.file.pipe(out);
        });
        const db = getDb();
        const uploadRef = db.collection(collections.uploads).doc();
        await uploadRef.set({
            createdAt: Timestamp.now(),
            filename: filePart.filename,
            mimeType: filePart.mimetype,
            storagePath,
            sizeBytes,
            sha256: hash.digest('hex'),
            status: 'STORED'
        });
        const customerName = (fields.customerName || fields.name || '').trim();
        const doctorName = (fields.doctorName || '').trim();
        const phoneNumber = (fields.phoneNumber || fields.phone || '').trim();
        const emailId = (fields.emailId || fields.email || '').trim();
        const dobRaw = (fields.dob || '').trim();
        const dob = dobRaw ? new Date(dobRaw) : null;
        const age = dob ? Math.max(0, Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000))) : null;
        const customerRef = customerName ? db.collection(collections.customers).doc() : null;
        if (customerRef) {
            await customerRef.set({
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
                customerName,
                dob: dob ? Timestamp.fromDate(dob) : null,
                age,
                imageAddress: storagePath,
                phoneNumber: phoneNumber || null,
                emailId: emailId || null,
                doctorNames: doctorName ? [doctorName] : [],
                records: [],
                paymentType: 'COD',
                paymentId: null,
                blockchain: null
            });
        }
        const prescriptionRef = db.collection(collections.prescriptions).doc();
        await prescriptionRef.set({
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            uploadId: uploadRef.id,
            customerId: customerRef?.id ?? null,
            doctorName: doctorName || null,
            date: Timestamp.now(),
            reporting: false,
            reportingDate: null,
            medicines: [],
            paymentType: 'COD',
            paymentId: null,
            blockchain: null,
            imageAddress: storagePath,
            status: 'UPLOADED'
        });
        const auditRef = db.collection(collections.auditEvents).doc();
        await auditRef.set({
            createdAt: Timestamp.now(),
            prescriptionId: prescriptionRef.id,
            action: 'UPLOAD_RECEIVED',
            metadata: { filename: filePart.filename }
        });
        if (customerRef) {
            // Maintain requested "records" JSON structure.
            const recordEntry = {
                prescription: {
                    id: prescriptionRef.id,
                    date: new Date().toISOString(),
                    reporting: false,
                    reportingDate: null,
                    medicines: []
                }
            };
            const snap = await customerRef.get();
            const data = snap.data() ?? {};
            const existingRecords = Array.isArray(data.records) ? data.records : [];
            const existingDoctors = Array.isArray(data.doctorNames) ? data.doctorNames : [];
            const nextDoctors = doctorName
                ? Array.from(new Set([...existingDoctors.map(String), doctorName]))
                : existingDoctors.map(String);
            await customerRef.update({
                updatedAt: Timestamp.now(),
                records: [...existingRecords, recordEntry],
                doctorNames: nextDoctors
            });
        }
        const extraction = await orchestrateExtraction({ prescriptionId: prescriptionRef.id });
        return reply.send({
            prescriptionId: prescriptionRef.id,
            extractionId: extraction.extractionId,
            extraction: extraction.extraction
        });
    });
}
