import { runPrescriptionExtraction } from '../tools/mcpExtractor.js';
import { getDb, Timestamp } from '../db/firestore.js';
import { collections } from '../db/collections.js';

export async function orchestrateExtraction(input: { prescriptionId: string }) {
  const db = getDb();
  const presRef = db.collection(collections.prescriptions).doc(input.prescriptionId);
  const presSnap = await presRef.get();
  const pres = presSnap.data();
  if (!pres) throw new Error('Prescription not found');

  await presRef.update({
    updatedAt: Timestamp.now(),
    status: 'EXTRACTING'
  });

  // Ensure an extraction doc exists immediately so the UI can track progress.
  const extractionRef = db.collection(collections.extractions).doc(input.prescriptionId);
  await extractionRef.set(
    {
      createdAt: Timestamp.now(),
      prescriptionId: input.prescriptionId,
      status: 'STARTED',
      rawJson: null,
      confidence: null,
      source: null,
      error: null
    },
    { merge: true }
  );

  const uploadSnap = await db.collection(collections.uploads).doc(String(pres.uploadId)).get();
  const upload = uploadSnap.data();
  if (!upload) throw new Error('Upload not found');

  try {
    const extracted = await runPrescriptionExtraction({
      uploadPath: String(upload.storagePath),
      mimeType: String(upload.mimeType),
      filename: String(upload.filename)
    });

    await extractionRef.set(
      {
        updatedAt: Timestamp.now(),
        rawJson: extracted.json,
        confidence: extracted.confidence,
        source: extracted.source,
        status: 'COMPLETED',
        error: null
      },
      { merge: true }
    );

    await presRef.update({
      updatedAt: Timestamp.now(),
      status: 'EXTRACTED'
    });

    const auditRef = db.collection(collections.auditEvents).doc();
    await auditRef.set({
      createdAt: Timestamp.now(),
      prescriptionId: input.prescriptionId,
      action: 'EXTRACTION_COMPLETED',
      metadata: extracted.json
    });

    return { extractionId: extractionRef.id, extraction: extracted.json };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : null;

    await extractionRef.set(
      {
        updatedAt: Timestamp.now(),
        status: 'FAILED',
        error: { message, stack }
      },
      { merge: true }
    );

    await presRef.update({
      updatedAt: Timestamp.now(),
      status: 'EXTRACTION_FAILED'
    });

    const auditRef = db.collection(collections.auditEvents).doc();
    await auditRef.set({
      createdAt: Timestamp.now(),
      prescriptionId: input.prescriptionId,
      action: 'EXTRACTION_FAILED',
      metadata: { message, stack }
    });

    throw err;
  }
}
