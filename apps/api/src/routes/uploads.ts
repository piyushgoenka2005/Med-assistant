import type { FastifyInstance } from 'fastify';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../env.js';
import { orchestrateExtraction } from '../orchestrator/extraction.js';
import { getDb, Timestamp } from '../db/firestore.js';
import { collections } from '../db/collections.js';
import { isAllowedPrescriptionMimeType } from '../tools/fileType.js';

export async function uploadRoutes(app: FastifyInstance) {
  app.post('/prescription', async (req, reply) => {
    const parts = req.parts();
    const fields: Record<string, string> = {};

    // IMPORTANT: In @fastify/multipart, you must consume the file stream.
    // If you just store the part and keep iterating, the parser stalls and the client
    // eventually times out, causing ECONNRESET/"socket hang up".
    let fileInfo: { uploadId: string; filename: string; mimetype: string; storagePath: string } | null = null;
    let fileWritePromise: Promise<void> | null = null;
    const hash = crypto.createHash('sha256');
    let sizeBytes = 0;

    for await (const part of parts) {
      if (part.type === 'file') {
        // Keep the first file only.
        if (fileWritePromise) {
          part.file.resume();
          continue;
        }

        const filename = String(part.filename ?? 'upload');
        const mimetype = String(part.mimetype ?? 'application/octet-stream');

        if (!isAllowedPrescriptionMimeType(mimetype)) {
          part.file.resume();
          return reply.badRequest('Unsupported file type. Please upload PDF, PNG, or JPEG.');
        }

        await fs.mkdir(env.UPLOAD_DIR, { recursive: true });

        const uploadId = crypto.randomUUID();
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = path.join(env.UPLOAD_DIR, `${uploadId}-${safeName}`);

        fileInfo = { uploadId, filename, mimetype, storagePath };

        fileWritePromise = new Promise<void>((resolve, reject) => {
          const out = createWriteStream(storagePath);
          part.file.on('data', (chunk: Buffer) => {
            sizeBytes += chunk.length;
            hash.update(chunk);
          });
          part.file.on('error', reject);
          out.on('error', reject);
          out.on('finish', () => resolve());
          part.file.pipe(out);
        });
      } else {
        fields[part.fieldname] = String(part.value ?? '');
      }
    }

    if (!fileInfo || !fileWritePromise) return reply.badRequest('Missing file');

    await fileWritePromise;
    const sha256 = hash.digest('hex');

    const db = getDb();

    const uploadRef = db.collection(collections.uploads).doc();
    await uploadRef.set({
      createdAt: Timestamp.now(),
      filename: fileInfo.filename,
      mimeType: fileInfo.mimetype,
      storagePath: fileInfo.storagePath,
      sizeBytes,
      sha256,
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
        imageAddress: fileInfo.storagePath,
        phoneNumber: phoneNumber || null,
        emailId: emailId || null,
        doctorNames: doctorName ? [doctorName] : [],
        records: [],
        loyaltyPoints: 120,
        insuranceCoveragePct: 15,
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
      imageAddress: fileInfo.storagePath,
      status: 'EXTRACTING'
    });

    const auditRef = db.collection(collections.auditEvents).doc();
    await auditRef.set({
      createdAt: Timestamp.now(),
      prescriptionId: prescriptionRef.id,
      action: 'UPLOAD_RECEIVED',
      metadata: { filename: fileInfo.filename }
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

    // Kick off extraction in the background so this endpoint stays fast/stable.
    // This prevents long OCR/LLM work from causing client-side timeouts or connection resets.
    void (async () => {
      app.log.info({ prescriptionId: prescriptionRef.id }, 'extraction:started');
      try {
        await orchestrateExtraction({ prescriptionId: prescriptionRef.id });
        app.log.info({ prescriptionId: prescriptionRef.id }, 'extraction:completed');
      } catch (err) {
        app.log.error(
          {
            prescriptionId: prescriptionRef.id,
            err: err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) }
          },
          'extraction:failed'
        );
        try {
          await db.collection(collections.auditEvents).doc().set({
            createdAt: Timestamp.now(),
            prescriptionId: prescriptionRef.id,
            action: 'EXTRACTION_FAILED',
            metadata: {
              message: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : null
            }
          });
          await prescriptionRef.update({
            updatedAt: Timestamp.now(),
            status: 'EXTRACTION_FAILED'
          });
        } catch {
          // Swallow failures in failure-reporting path.
        }
      }
    })();

    return reply.send({
      prescriptionId: prescriptionRef.id,
      extractionId: null,
      extraction: null
    });
  });
}
