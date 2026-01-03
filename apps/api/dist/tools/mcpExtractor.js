import { PrescriptionExtractionSchema } from '@medi/shared';
import { env } from '../env.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
async function ocrSpaceText(input) {
    if (!env.OCR_SPACE_API_KEY)
        throw new Error('OCR_SPACE_API_KEY is not configured');
    const buffer = await fs.readFile(input.uploadPath);
    const form = new FormData();
    form.append('apikey', env.OCR_SPACE_API_KEY);
    form.append('language', 'eng');
    form.append('isOverlayRequired', 'false');
    form.append('OCREngine', '2');
    const mime = input.mimeType.toLowerCase();
    const ext = path.extname(input.filename || '').toLowerCase();
    const contentType = mime || (ext === '.pdf' ? 'application/pdf' : 'application/octet-stream');
    const blob = new Blob([buffer], { type: contentType });
    form.append('file', blob, input.filename || path.basename(input.uploadPath));
    const res = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        body: form
    });
    if (!res.ok)
        throw new Error(`OCR.space failed: ${res.status}`);
    const data = (await res.json());
    if (data?.IsErroredOnProcessing) {
        const msg = Array.isArray(data?.ErrorMessage) ? data.ErrorMessage.join('; ') : String(data?.ErrorMessage ?? 'OCR error');
        throw new Error(msg);
    }
    return String(data?.ParsedResults?.[0]?.ParsedText ?? '').trim();
}
export async function runPrescriptionExtraction(input) {
    if (!env.OPENROUTER_API_KEY) {
        const mocked = {
            prescriberName: 'Dr. Example',
            patientName: 'Patient Example',
            issuedDate: new Date().toISOString().slice(0, 10),
            medications: [
                {
                    name: 'Paracetamol',
                    strength: '500mg',
                    form: 'tablet',
                    dosage: '1 tablet',
                    frequency: 'twice daily',
                    durationDays: 3,
                    specialInstructions: 'After food',
                    quantity: 6
                }
            ],
            notes: `Mock extraction (set OPENROUTER_API_KEY to enable LLM) for ${input.filename} (${input.mimeType}) at ${input.uploadPath}`,
            confidence: 0.6
        };
        const parsed = PrescriptionExtractionSchema.parse(mocked);
        return { json: parsed, confidence: parsed.confidence ?? 0.6, source: 'openrouter-mock' };
    }
    const model = env.OPENROUTER_MODEL ?? 'nvidia/nemotron-nano-9b-v2:free';
    const baseUrl = (env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    const systemPrompt = 'You are an expert medical prescription parser. Extract structured data from the prescription. ' +
        'Return ONLY valid JSON matching this schema: { prescriberName?, patientName?, issuedDate?, medications: [{ name, strength?, form?, dosage?, frequency?, durationDays?, specialInstructions?, quantity? }], notes?, confidence? }. ' +
        'No markdown, no code fences, no extra keys.';
    const mime = input.mimeType.toLowerCase();
    // Prefer OCR.Space for both images and PDFs (as requested).
    // If OCR isn't configured, fall back to the previous vision/PDF-text approaches.
    let userContent;
    if (env.OCR_SPACE_API_KEY) {
        const ocrText = await ocrSpaceText({ uploadPath: input.uploadPath, filename: input.filename, mimeType: input.mimeType });
        userContent = [
            {
                type: 'text',
                text: ocrText.length > 0
                    ? `Filename: ${input.filename}\n\nOCR Text:\n${ocrText.slice(0, 20_000)}`
                    : `Filename: ${input.filename}\n\nOCR returned empty text. Provide best-effort extraction and set low confidence.`
            }
        ];
    }
    else {
        const fileBuf = await fs.readFile(input.uploadPath);
        if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg') {
            const b64 = fileBuf.toString('base64');
            const dataUrl = `data:${mime};base64,${b64}`;
            userContent = [
                { type: 'text', text: `Filename: ${input.filename}. Extract medications and instructions.` },
                { type: 'image_url', image_url: { url: dataUrl } }
            ];
        }
        else if (mime === 'application/pdf') {
            let text = '';
            try {
                const pdfParseMod = await import('pdf-parse');
                const pdfParse = pdfParseMod.default ?? pdfParseMod;
                const out = await pdfParse(fileBuf);
                text = String(out?.text ?? '').trim();
            }
            catch {
                text = '';
            }
            userContent = [
                {
                    type: 'text',
                    text: text.length > 0
                        ? `Extract from this PDF text:\n\n${text.slice(0, 20_000)}`
                        : `The user uploaded a PDF (${input.filename}) but text extraction returned empty. Provide best-effort extraction and set low confidence.`
                }
            ];
        }
        else {
            throw new Error(`Unsupported mimeType for extraction: ${input.mimeType}`);
        }
    }
    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            'content-type': 'application/json',
            ...(env.OPENROUTER_SITE_URL ? { 'HTTP-Referer': env.OPENROUTER_SITE_URL } : {}),
            ...(env.OPENROUTER_APP_NAME ? { 'X-Title': env.OPENROUTER_APP_NAME } : {})
        },
        body: JSON.stringify({
            model,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ]
        })
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenRouter extraction failed: ${res.status} ${text}`);
    }
    const data = (await res.json());
    const content = String(data?.choices?.[0]?.message?.content ?? '').trim();
    const json = safeJsonParse(content);
    const parsed = PrescriptionExtractionSchema.parse(json);
    return { json: parsed, confidence: parsed.confidence ?? 0.75, source: env.OCR_SPACE_API_KEY ? `ocrspace+openrouter:${model}` : `openrouter:${model}` };
}
function safeJsonParse(input) {
    // Some models still wrap JSON in code fences; strip if present.
    const stripped = input
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    try {
        return JSON.parse(stripped);
    }
    catch {
        // Last resort: extract the first {...} block.
        const start = stripped.indexOf('{');
        const end = stripped.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return JSON.parse(stripped.slice(start, end + 1));
        }
        throw new Error('LLM did not return valid JSON');
    }
}
