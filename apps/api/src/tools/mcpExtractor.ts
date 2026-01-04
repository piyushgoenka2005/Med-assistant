import { PrescriptionExtractionSchema } from '@medi/shared';
import { env } from '../env.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

async function fetchWithTimeout(input: string | URL, init: RequestInit & { timeoutMs?: number } = {}) {
  const timeoutMs = init.timeoutMs ?? 25_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { timeoutMs: _timeoutMs, ...rest } = init;
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function callGemini(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userParts: any[];
  timeoutMs: number;
}) {
  const baseUrl = params.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;

  const body = {
    systemInstruction: {
      parts: [{ text: params.systemPrompt }]
    },
    contents: [
      {
        role: 'user',
        parts: params.userParts
      }
    ],
    generationConfig: {
      temperature: 0
    }
  };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        timeoutMs: params.timeoutMs
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if ((res.status >= 500 || res.status === 429) && attempt < maxAttempts) {
          await sleep(500 * attempt);
          continue;
        }
        throw new Error(`Gemini extraction failed: ${res.status}${text ? ` ${text}` : ''}`);
      }

      const data = (await res.json()) as any;
      const content = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
      return content;
    } catch (e) {
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      throw e;
    }
  }

  throw new Error('Gemini extraction failed');
}

async function callOpenRouter(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: any[];
  timeoutMs: number;
}) {
  const url = `${params.baseUrl}/chat/completions`;

  // NOTE: Do NOT send response_format by default.
  // OpenRouter (or some upstreams/models) can return 500 for response_format requests.
  const body = {
    model: params.model,
    temperature: 0,
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userContent }
    ]
  };

  // Retry on transient failures (5xx, 429, timeouts).
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${params.apiKey}`,
          'content-type': 'application/json',
          ...(env.OPENROUTER_SITE_URL ? { 'HTTP-Referer': env.OPENROUTER_SITE_URL } : {}),
          ...(env.OPENROUTER_APP_NAME ? { 'X-Title': env.OPENROUTER_APP_NAME } : {})
        },
        body: JSON.stringify(body),
        timeoutMs: params.timeoutMs
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const requestId = res.headers.get('x-request-id') || res.headers.get('x-openrouter-request-id');

        // Retry only if it looks transient.
        if ((res.status >= 500 || res.status === 429) && attempt < maxAttempts) {
          await sleep(500 * attempt);
          continue;
        }

        throw new Error(
          `OpenRouter extraction failed: ${res.status}` +
            (requestId ? ` (requestId=${requestId})` : '') +
            (text ? ` ${text}` : '')
        );
      }

      const data = (await res.json()) as any;
      const content = String(data?.choices?.[0]?.message?.content ?? '').trim();
      return content;
    } catch (e) {
      // Retry on timeouts / network errors
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      throw e;
    }
  }

  throw new Error('OpenRouter extraction failed');
}

async function ocrSpaceText(input: { uploadPath: string; filename: string; mimeType: string }): Promise<string> {
  if (!env.OCR_SPACE_API_KEY) throw new Error('OCR_SPACE_API_KEY is not configured');

  const buffer = await fs.readFile(input.uploadPath);

  const form = new FormData();
  form.append('apikey', env.OCR_SPACE_API_KEY);
  form.append('language', 'eng');
  form.append('isOverlayRequired', 'false');
  form.append('OCREngine', '2');
  // Improve results for camera photos / scanned docs.
  form.append('scale', 'true');
  form.append('detectOrientation', 'true');

  const mime = input.mimeType.toLowerCase();
  const ext = path.extname(input.filename || '').toLowerCase();
  const contentType = mime || (ext === '.pdf' ? 'application/pdf' : 'application/octet-stream');
  const blob = new Blob([buffer], { type: contentType });
  form.append('file', blob, input.filename || path.basename(input.uploadPath));

  const res = await fetchWithTimeout('https://api.ocr.space/parse/image', {
    method: 'POST',
    body: form,
    timeoutMs: 30_000
  });

  if (!res.ok) throw new Error(`OCR.space failed: ${res.status}`);
  const data = (await res.json()) as any;
  if (data?.IsErroredOnProcessing) {
    const msg = Array.isArray(data?.ErrorMessage) ? data.ErrorMessage.join('; ') : String(data?.ErrorMessage ?? 'OCR error');
    throw new Error(msg);
  }

  return String(data?.ParsedResults?.[0]?.ParsedText ?? '').trim();
}

function heuristicExtractionFromText(sourceText: string, notesPrefix: string): { json: unknown; confidence: number; source: string } {
  const text = String(sourceText || '').replace(/\r\n/g, '\n');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 3);

  const meds: any[] = [];

  const strengthRe = /(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu))(?:\b|\s)/i;
  const formRe = /\b(tablet|tab|capsule|cap|syrup|syp|drops|drop|ointment|cream|gel|injection|inj)\b/i;
  const freqRe = /\b(once daily|twice daily|thrice daily|daily|bd|b\.d\.|tid|t\.i\.d\.|od|o\.d\.|hs|sos)\b/i;
  const durationRe = /\bfor\s+(\d+)\s*(day|days|week|weeks|month|months)\b/i;
  const qtyRe = /\b(qty|quantity)\s*[:=-]?\s*(\d+)\b/i;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ');

    // Likely-medication lines tend to contain a strength/form.
    if (!strengthRe.test(line) && !formRe.test(line)) continue;

    const strengthMatch = line.match(strengthRe);
    const strength = strengthMatch ? strengthMatch[1].replace(/\s+/g, '') : undefined;

    const formMatch = line.match(formRe);
    const form = formMatch ? formMatch[1].toLowerCase() : undefined;

    const qtyMatch = line.match(qtyRe);
    const quantity = qtyMatch ? Number(qtyMatch[2]) : undefined;

    const freqMatch = line.match(freqRe);
    const frequency = freqMatch ? freqMatch[1].toLowerCase() : undefined;

    const durationMatch = line.match(durationRe);
    let durationDays: number | undefined;
    if (durationMatch) {
      const n = Number(durationMatch[1]);
      const unit = durationMatch[2].toLowerCase();
      if (Number.isFinite(n)) {
        if (unit.startsWith('day')) durationDays = n;
        else if (unit.startsWith('week')) durationDays = n * 7;
        else if (unit.startsWith('month')) durationDays = n * 30;
      }
    }

    // Extract a name by taking text before strength or first comma.
    let namePart = line;
    if (strengthMatch?.index != null && strengthMatch.index > 0) {
      namePart = line.slice(0, strengthMatch.index).trim();
    }
    namePart = namePart.replace(/\b(rx|tab|tablet|cap|capsule|syp|syrup|inj|injection)\b[: ]*/gi, '').trim();
    namePart = namePart.replace(/[-–—]+/g, ' ').trim();
    // Keep it short-ish.
    const tokens = namePart.split(' ').filter(Boolean);
    const name = tokens.slice(0, 4).join(' ').trim();
    if (!name) continue;

    meds.push({
      name,
      strength,
      form,
      dosage: undefined,
      frequency,
      durationDays,
      specialInstructions: undefined,
      quantity
    });
  }

  // Deduplicate by name+strength.
  const uniq = new Map<string, any>();
  for (const m of meds) {
    const key = `${String(m.name).toLowerCase()}|${String(m.strength ?? '').toLowerCase()}`;
    if (!uniq.has(key)) uniq.set(key, m);
  }

  const medications = Array.from(uniq.values());

  // Zod optional fields do not accept `null`; also ensure numbers are positive integers when present.
  const normalizedMeds = medications
    .map((m) => {
      const cleaned: any = {
        name: String(m.name || '').trim()
      };

      if (typeof m.strength === 'string' && m.strength.trim()) cleaned.strength = m.strength.trim();
      if (typeof m.form === 'string' && m.form.trim()) cleaned.form = m.form.trim();
      if (typeof m.dosage === 'string' && m.dosage.trim()) cleaned.dosage = m.dosage.trim();
      if (typeof m.frequency === 'string' && m.frequency.trim()) cleaned.frequency = m.frequency.trim();
      if (typeof m.specialInstructions === 'string' && m.specialInstructions.trim()) cleaned.specialInstructions = m.specialInstructions.trim();

      if (typeof m.durationDays === 'number' && Number.isFinite(m.durationDays)) {
        const n = Math.trunc(m.durationDays);
        if (n > 0) cleaned.durationDays = n;
      }

      if (typeof m.quantity === 'number' && Number.isFinite(m.quantity)) {
        const n = Math.trunc(m.quantity);
        if (n > 0) cleaned.quantity = n;
      }

      return cleaned;
    })
    .filter((m) => m.name.length > 0);

  const mocked = {
    medications: normalizedMeds,
    notes:
      `${notesPrefix}\n` +
      (normalizedMeds.length > 0
        ? 'Generated via heuristic parsing because LLM extraction failed.'
        : 'No medications detected by heuristic parsing. Check OCR quality.'),
    confidence: normalizedMeds.length > 0 ? 0.35 : 0.15
  };

  const parsed = PrescriptionExtractionSchema.parse(mocked);
  return { json: parsed, confidence: parsed.confidence ?? 0.2, source: 'heuristic' };
}

export async function runPrescriptionExtraction(input: {
  uploadPath: string;
  mimeType: string;
  filename: string;
}): Promise<{ json: unknown; confidence: number; source: string }> {
  const hasGemini = Boolean(env.GEMINI_API_KEY);
  const hasOpenRouter = Boolean(env.OPENROUTER_API_KEY);

  if (!hasGemini && !hasOpenRouter) {
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

  const geminiModel = env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  const geminiBaseUrl = env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';
  const openRouterModel = env.OPENROUTER_MODEL ?? 'nvidia/nemotron-nano-9b-v2:free';
  const openRouterBaseUrl = (env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');

  const systemPrompt =
    'You are an expert medical prescription parser. Extract structured data from the prescription. ' +
    'Return ONLY valid JSON matching this schema: { prescriberName?, patientName?, issuedDate?, medications: [{ name, strength?, form?, dosage?, frequency?, durationDays?, specialInstructions?, quantity? }], notes?, confidence? }. ' +
    'No markdown, no code fences, no extra keys.';

  const mime = input.mimeType.toLowerCase();

  // Prefer OCR.Space text when available (stable + cheap), otherwise for images we can
  // optionally rely on Gemini's multimodal capability.
  let sourceTextForFallback = '';
  let geminiParts: any[] = [];
  let openRouterUserContent: any[] = [];

  const fileBuf = await fs.readFile(input.uploadPath);

  if (env.OCR_SPACE_API_KEY) {
    const ocrText = await ocrSpaceText({ uploadPath: input.uploadPath, filename: input.filename, mimeType: input.mimeType });
    sourceTextForFallback = ocrText;
    const textPrompt =
      ocrText.length > 0
        ? `Filename: ${input.filename}\n\nOCR Text:\n${ocrText.slice(0, 8_000)}`
        : `Filename: ${input.filename}\n\nOCR returned empty text. Provide best-effort extraction and set low confidence.`;

    geminiParts = [{ text: textPrompt }];
    openRouterUserContent = [{ type: 'text', text: textPrompt }];
  } else if (mime === 'application/pdf') {
    let text = '';
    try {
      const pdfParseMod = await import('pdf-parse');
      const pdfParse = (pdfParseMod as any).default ?? pdfParseMod;
      const out = await pdfParse(fileBuf);
      text = String(out?.text ?? '').trim();
    } catch {
      text = '';
    }

    sourceTextForFallback = text;
    const textPrompt =
      text.length > 0
        ? `Extract from this PDF text:\n\n${text.slice(0, 8_000)}`
        : `The user uploaded a PDF (${input.filename}) but text extraction returned empty. Provide best-effort extraction and set low confidence.`;
    geminiParts = [{ text: textPrompt }];
    openRouterUserContent = [{ type: 'text', text: textPrompt }];
  } else if (mime === 'text/plain') {
    const text = fileBuf.toString('utf8').trim();
    sourceTextForFallback = text;
    const textPrompt =
      text.length > 0
        ? `Extract from this text file:\n\n${text.slice(0, 8_000)}`
        : `The user uploaded a text file (${input.filename}) but it was empty. Provide best-effort extraction and set low confidence.`;
    geminiParts = [{ text: textPrompt }];
    openRouterUserContent = [{ type: 'text', text: textPrompt }];
  } else if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg') {
    if (!hasGemini) {
      throw new Error(
        'Image uploads require OCR or a multimodal model. ' +
          'Set OCR_SPACE_API_KEY (OCR.space) or GEMINI_API_KEY (Gemini) to enable extraction.'
      );
    }

    // Gemini multimodal: send the image directly.
    const b64 = Buffer.from(fileBuf).toString('base64');
    geminiParts = [
      { text: `Filename: ${input.filename}. Extract structured prescription data from this image.` },
      { inlineData: { mimeType: input.mimeType, data: b64 } }
    ];

    // No reliable text for heuristics without OCR.
    sourceTextForFallback = '';
    openRouterUserContent = [];
  } else {
    throw new Error(`Unsupported mimeType for extraction: ${input.mimeType}`);
  }

  let content = '';
  let usedProvider = '';

  // Preferred: Gemini 2.5 Flash.
  if (hasGemini) {
    try {
      usedProvider = `gemini:${geminiModel}`;
      content = await callGemini({
        baseUrl: geminiBaseUrl,
        apiKey: env.GEMINI_API_KEY as string,
        model: geminiModel,
        systemPrompt,
        userParts: geminiParts,
        timeoutMs: 45_000
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // If Gemini fails and we have text, heuristics are the safest fallback.
      if (sourceTextForFallback) {
        return heuristicExtractionFromText(
          sourceTextForFallback,
          `Gemini extraction failed (${msg}). File: ${input.filename} (${input.mimeType}).`
        );
      }
      // Otherwise, fall through to OpenRouter if available.
      content = '';
    }
  }

  // Fallback: OpenRouter (if Gemini not configured or failed).
  if (!content && hasOpenRouter) {
    const fallbackModel = 'qwen/qwen3-coder:free';
    let usedModel = openRouterModel;
    try {
      content = await callOpenRouter({
        baseUrl: openRouterBaseUrl,
        apiKey: env.OPENROUTER_API_KEY as string,
        model: openRouterModel,
        systemPrompt,
        userContent: openRouterUserContent,
        timeoutMs: 45_000
      });
    } catch (e) {
      if (openRouterModel !== fallbackModel) {
        try {
          usedModel = fallbackModel;
          content = await callOpenRouter({
            baseUrl: openRouterBaseUrl,
            apiKey: env.OPENROUTER_API_KEY as string,
            model: fallbackModel,
            systemPrompt,
            userContent: openRouterUserContent,
            timeoutMs: 45_000
          });
        } catch (e2) {
          const msg = e2 instanceof Error ? e2.message : String(e2);
          return heuristicExtractionFromText(
            sourceTextForFallback,
            `LLM extraction failed (${msg}). File: ${input.filename} (${input.mimeType}).`
          );
        }
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        return heuristicExtractionFromText(
          sourceTextForFallback,
          `LLM extraction failed (${msg}). File: ${input.filename} (${input.mimeType}).`
        );
      }
    }
    usedProvider = env.OCR_SPACE_API_KEY ? `ocrspace+openrouter:${usedModel}` : `openrouter:${usedModel}`;
  }

  // If fallback model also fails, use heuristics.
  if (!content) {
    return heuristicExtractionFromText(
      sourceTextForFallback,
      `LLM extraction returned empty content. File: ${input.filename} (${input.mimeType}).`
    );
  }

  const json = safeJsonParse(content);
  const normalized = normalizeExtractionCandidate(json);
  const parsed = PrescriptionExtractionSchema.safeParse(normalized);
  if (!parsed.success) {
    const issue = parsed.error.issues?.[0];
    const msg = issue ? `${issue.path.join('.') || 'root'}: ${issue.message}` : 'Schema validation failed';
    return heuristicExtractionFromText(
      sourceTextForFallback,
      `LLM returned invalid JSON for schema (${msg}). File: ${input.filename} (${input.mimeType}).`
    );
  }

  // Note: if fallback was used, the returned content still parses into the schema.
  return {
    json: parsed.data,
    confidence: parsed.data.confidence ?? 0.75,
    source: usedProvider || (env.OCR_SPACE_API_KEY ? `ocrspace+gemini:${geminiModel}` : `gemini:${geminiModel}`)
  };
}

function normalizeExtractionCandidate(input: unknown): unknown {
  const stripped = stripNullsDeep(input);
  const obj = (stripped && typeof stripped === 'object' && !Array.isArray(stripped)) ? (stripped as any) : {};

  const medicationsRaw = Array.isArray(obj.medications) ? obj.medications : [];
  const medications = medicationsRaw
    .map((m: any) => {
      if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
      const name = typeof m.name === 'string' ? m.name.trim() : '';
      if (!name) return null;

      const cleaned: any = { name };

      for (const key of ['strength', 'form', 'dosage', 'frequency', 'specialInstructions'] as const) {
        const v = (m as any)[key];
        if (typeof v === 'string') {
          const t = v.trim();
          if (t) cleaned[key] = t;
        }
      }

      for (const key of ['durationDays', 'quantity'] as const) {
        const v = (m as any)[key];
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
        if (Number.isFinite(n)) {
          const i = Math.trunc(n);
          if (i > 0) cleaned[key] = i;
        }
      }

      return cleaned;
    })
    .filter(Boolean);

  const out: any = { medications };

  for (const key of ['prescriberName', 'patientName', 'issuedDate', 'notes'] as const) {
    const v = obj[key];
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) out[key] = t;
    }
  }

  const conf = obj.confidence;
  if (typeof conf === 'number' && Number.isFinite(conf)) {
    const c = Math.max(0, Math.min(1, conf));
    out.confidence = c;
  }

  return out;
}

function stripNullsDeep(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((v) => stripNullsDeep(v))
      .filter((v) => v !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const sv = stripNullsDeep(v);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  }
  return value;
}

function safeJsonParse(input: string) {
  // Some models still wrap JSON in code fences; strip if present.
  const stripped = input
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    // Last resort: extract the first {...} block.
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(stripped.slice(start, end + 1));
    }
    throw new Error('LLM did not return valid JSON');
  }
}
