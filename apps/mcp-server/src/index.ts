import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs/promises';
import { lookup as lookupMime } from 'mime-types';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

const ApiBaseUrlSchema = z
  .string()
  .url()
  .transform((s) => s.replace(/\/$/, ''));

const API_BASE_URL = ApiBaseUrlSchema.parse(
  process.env.MEDI_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://127.0.0.1:4000'
);

async function apiFetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.headers ?? {})
    }
  });

  const text = await res.text();
  const body = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    const msg =
      (body && typeof body === 'object' && 'message' in body && String((body as any).message)) ||
      text ||
      `HTTP ${res.status}`;
    throw new Error(`${res.status} ${res.statusText}: ${msg}`);
  }

  return body;
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toolText(payload: unknown) {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }]
  };
}

const UploadInput = z.object({
  filePath: z.string().min(1),
  customerName: z.string().optional(),
  doctorName: z.string().optional(),
  phoneNumber: z.string().optional(),
  emailId: z.string().optional(),
  dob: z.string().optional() // ISO date preferred
});

const IdInput = z.object({
  prescriptionId: z.string().min(1)
});

const VendorInput = z.object({
  vendor: z.enum(['site-a', 'site-b', 'site-c'])
});

const server = new Server(
  {
    name: '@medi/mcp-server',
    version: '0.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'medi.health',
        description: 'Ping the Medi API health endpoint to verify connectivity.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: 'medi.upload_prescription',
        description:
          'Upload a prescription file (PDF/PNG/JPEG) and trigger OCR+LLM extraction. Returns prescriptionId and extraction JSON.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Absolute path to the prescription file on disk.' },
            customerName: { type: 'string' },
            doctorName: { type: 'string' },
            phoneNumber: { type: 'string' },
            emailId: { type: 'string' },
            dob: { type: 'string', description: 'Date of birth (ISO string recommended, e.g. 2001-12-31).' }
          },
          required: ['filePath'],
          additionalProperties: false
        }
      },
      {
        name: 'medi.get_prescription',
        description: 'Fetch a prescription with upload, extraction, and cart (if available).',
        inputSchema: {
          type: 'object',
          properties: {
            prescriptionId: { type: 'string' }
          },
          required: ['prescriptionId'],
          additionalProperties: false
        }
      },
      {
        name: 'medi.extract_prescription',
        description: 'Re-run extraction (OCR+LLM) for a prescription ID.',
        inputSchema: {
          type: 'object',
          properties: {
            prescriptionId: { type: 'string' }
          },
          required: ['prescriptionId'],
          additionalProperties: false
        }
      },
      {
        name: 'medi.confirm_prescription',
        description: 'Confirm a prescription and build the cart by comparing vendor prices.',
        inputSchema: {
          type: 'object',
          properties: {
            prescriptionId: { type: 'string' }
          },
          required: ['prescriptionId'],
          additionalProperties: false
        }
      },
      {
        name: 'medi.place_cod_order',
        description: 'Place the COD order for a prescription (refreshes real-time pricing first).',
        inputSchema: {
          type: 'object',
          properties: {
            prescriptionId: { type: 'string' }
          },
          required: ['prescriptionId'],
          additionalProperties: false
        }
      },
      {
        name: 'medi.get_vendor_orders',
        description: 'Get order history for a dummy vendor (site-a/site-b/site-c).',
        inputSchema: {
          type: 'object',
          properties: {
            vendor: { type: 'string', enum: ['site-a', 'site-b', 'site-c'] }
          },
          required: ['vendor'],
          additionalProperties: false
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (name === 'medi.health') {
      const out = await apiFetchJson(`${API_BASE_URL}/health`);
      return toolText({ apiBaseUrl: API_BASE_URL, out });
    }

    if (name === 'medi.upload_prescription') {
      const input = UploadInput.parse(args ?? {});
      const absPath = path.resolve(input.filePath);
      const buf = await fs.readFile(absPath);
      const filename = path.basename(absPath);
      const mime = String(lookupMime(filename) || 'application/octet-stream');

      const form = new FormData();
      const file = new File([buf], filename, { type: mime });
      form.append('file', file);

      if (input.customerName) form.append('customerName', input.customerName);
      if (input.doctorName) form.append('doctorName', input.doctorName);
      if (input.phoneNumber) form.append('phoneNumber', input.phoneNumber);
      if (input.emailId) form.append('emailId', input.emailId);
      if (input.dob) form.append('dob', input.dob);

      const out = await apiFetchJson(`${API_BASE_URL}/v1/uploads/prescription`, {
        method: 'POST',
        body: form
      });

      return toolText(out);
    }

    if (name === 'medi.get_prescription') {
      const input = IdInput.parse(args ?? {});
      const out = await apiFetchJson(`${API_BASE_URL}/v1/prescriptions/${encodeURIComponent(input.prescriptionId)}`);
      return toolText(out);
    }

    if (name === 'medi.extract_prescription') {
      const input = IdInput.parse(args ?? {});
      const out = await apiFetchJson(
        `${API_BASE_URL}/v1/prescriptions/${encodeURIComponent(input.prescriptionId)}/extract`,
        { method: 'POST' }
      );
      return toolText(out);
    }

    if (name === 'medi.confirm_prescription') {
      const input = IdInput.parse(args ?? {});
      const out = await apiFetchJson(
        `${API_BASE_URL}/v1/prescriptions/${encodeURIComponent(input.prescriptionId)}/confirm`,
        { method: 'POST' }
      );
      return toolText(out);
    }

    if (name === 'medi.place_cod_order') {
      const input = IdInput.parse(args ?? {});
      const out = await apiFetchJson(`${API_BASE_URL}/v1/orders/cod`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prescriptionId: input.prescriptionId })
      });
      return toolText(out);
    }

    if (name === 'medi.get_vendor_orders') {
      const input = VendorInput.parse(args ?? {});
      const out = await apiFetchJson(`${API_BASE_URL}/dummy/${encodeURIComponent(input.vendor)}/orders`, {
        headers: { accept: 'application/json' }
      });
      return toolText(out);
    }

    return toolText(`Unknown tool: ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolText({ error: message, apiBaseUrl: API_BASE_URL });
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
