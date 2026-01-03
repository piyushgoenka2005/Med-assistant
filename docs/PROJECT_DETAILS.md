# Medi Platform (MVP) — Project Details

## 1) Executive Summary
Medi Platform is an end-to-end prescription automation MVP that lets a user upload a prescription (PDF/PNG/JPEG), automatically extracts structured medication information using OCR + LLM analysis, constructs a cart by comparing real-time prices across three vendor sources, places an order using Cash on Delivery (COD), and schedules reminders/check-ins (optionally in Google Calendar). Data is stored in Firebase Firestore, and a worker process consumes scheduled reminder jobs.

## 2) Goals and Scope
### In-scope (MVP)
- Upload prescription file (PDF/PNG/JPEG).
- Extract structured prescription data:
  - OCR via OCR.space
  - LLM analysis via OpenRouter (model: `nvidia/nemotron-nano-9b-v2:free` by default)
  - Output validated against a strict Zod schema.
- Store normalized records in Firestore (uploads, prescriptions, extractions, carts, orders, reminders, audit events).
- Auto-build cart by comparing three dummy vendor websites.
- Optional Pathway integration for “real-time” quoting via `PATHWAY_BASE_URL`.
- COD order placement.
- Vendor “purchase” reflected in selected vendor’s order history.
- Reminder scheduling after successful order placement; optional Google Calendar event creation.

### Out-of-scope (MVP)
- Real payment gateways (UPI/cards), refunds, and settlements.
- Production-grade pharmacy partner integrations.
- Medical compliance, e-prescribing standards, insurance.
- Patient identity verification, KYC, or regulated consent flows.

## 3) Architecture Overview
### Components
- **Web app (Next.js)**: UI for upload → review extraction → confirm → place COD order.
- **API (Fastify)**: file upload, extraction orchestration, cart construction, vendor selection, ordering, reminders.
- **Worker (Node/TS)**: polls Firestore for due reminders and processes/sends them.
- **MCP server (Model Context Protocol)**: exposes Medi actions as MCP tools (stdio) by delegating to the API.
- **Firestore (Firebase Admin SDK)**: data persistence for all domain records.
- **External services**:
  - OCR.space: OCR text extraction.
  - OpenRouter: LLM analysis to convert OCR text into structured JSON.
  - Pathway (optional): quote totals in near real-time (MVP uses a compatible stub endpoint).
  - Google Calendar (optional): create reminder/check-in events.

### Data Flow (high level)
1. Web uploads file → API `/v1/uploads/prescription`.
2. API stores file (disk) + writes `uploads`, `prescriptions`, `customers` (optional).
3. API runs extraction (OCR → LLM) and writes `extractions`.
4. User confirms → API builds cart from extraction and prices 3 vendors → writes `carts`.
5. User places COD → API refreshes pricing (real-time), purchases from selected vendor, writes `orders`.
6. API schedules reminders + optional Google Calendar events; writes `reminders`.
7. Worker polls reminders and processes due ones.

## 4) Key User Flows
### 4.1 Upload and Extraction
- User supplies:
  - Prescription file (PDF/PNG/JPEG)
  - Patient details (name required; others optional)
- API actions:
  - Validates MIME type.
  - Stores file in `UPLOAD_DIR` and hashes it.
  - Creates Firestore records:
    - `uploads` (file metadata)
    - `prescriptions` (status: `UPLOADED`)
    - `customers` (optional, depending on input)
  - Triggers extraction:
    - OCR.space returns text
    - OpenRouter converts text to structured JSON
    - Zod validates output
    - Writes `extractions` and updates prescription status to `EXTRACTED`

### 4.2 Confirm and Auto-Build Cart
- User hits “Confirm & Build Cart” on prescription page.
- API:
  - Reads `extractions/{prescriptionId}`
  - Builds cart items from extracted `medications[]`
  - Queries 3 dummy vendors for availability and price
  - (Optional) calls Pathway `/quote` per vendor for “real-time” totals
  - Selects lowest quoted total vendor
  - Writes/updates `carts/{prescriptionId}` with:
    - chosen vendor
    - pricing breakdown
    - per-vendor totals

### 4.3 COD Order + Vendor Purchase
- User hits “Place Order (COD)”.
- API:
  - Recomputes vendor totals (real-time) to reflect current quotes.
  - Calls selected vendor purchase endpoint:
    - `POST /dummy/<vendor>/purchase`
  - Writes Firestore `orders` with:
    - payment provider: `cod`
    - `vendor` + `vendorOrderId` (so vendor order history reflects purchase)
  - Writes audit event `ORDER_PLACED_COD`.

### 4.4 Reminders and Check-ins
- After order placement:
  - API schedules default reminders.
  - If Google Calendar is configured, creates calendar events and stores event IDs.
- Worker:
  - Polls Firestore `reminders`.
  - Sends reminders (MVP placeholder) and updates attempt/status.

## 5) Data Model (Firestore)
Collections (current MVP):
- `uploads`: file metadata (storage path, mime type, hash).
- `customers`: patient profile + requested `records[]` structure.
- `prescriptions`: ties upload, customer, extraction, medicines, payment.
- `extractions`: one per prescription; stores extracted JSON and confidence.
- `carts`: one per prescription; vendor selection + pricing + items.
- `orders`: one per purchase; COD payment reference + vendor linkage.
- `vendorOrders`: dummy vendor order history (by vendor).
- `reminders`: scheduled reminder jobs.
- `auditEvents`: append-only log of major actions.

### Customer requested structure (supported)
- `customers` includes: `customerName`, `dob`, `age`, `imageAddress`, `doctorNames[]`, `records[]`, `paymentType`, `paymentId`, `blockchain`.
- Each `record` contains a `prescription` object with id/date/reporting/reportingDate/medicines.

## 6) API Surface (summary)
- `POST /v1/uploads/prescription`: multipart upload + patient fields; creates prescription and extraction.
- `GET /v1/prescriptions/:id`: fetch prescription with upload/extraction/cart.
- `POST /v1/prescriptions/:id/confirm`: build cart and vendor selection.
- `POST /v1/orders/cod`: place order; refresh pricing; purchase with selected vendor; schedule reminders.

Dummy vendor endpoints:
- `GET /dummy/site-a|site-b|site-c?name=...&qty=...` → HTML (default) or JSON (`Accept: application/json`).
- `POST /dummy/<vendor>/purchase` → creates vendor order record.
- `GET /dummy/<vendor>/orders` → HTML (default) or JSON.

## 7) External Integrations
### 7.1 OCR.space
- Used for OCR on both images and PDFs.
- Outputs raw text used as LLM input.

### 7.2 OpenRouter
- OpenAI-compatible `/chat/completions` endpoint.
- Model default: `nvidia/nemotron-nano-9b-v2:free`.
- Response is constrained to JSON (`response_format: json_object`) then validated by Zod.

### 7.3 Pathway (optional)
- If configured, API posts to `${PATHWAY_BASE_URL}/quote`.
- Expected request:
  - `{ selectedVendor, subtotal, deliveryFee, currency }`
- Expected response:
  - `{ total, deliveryFee, currency }`

### 7.4 Google Calendar (optional)
- Service-account JWT auth.
- Creates events for reminders/check-ins after COD order.

## 8) Environment Variables
Configured in repo-root `.env` (loaded by API and web):
- **Firebase**: `GOOGLE_APPLICATION_CREDENTIALS` (recommended) or inline `FIREBASE_*`.
- **Web**: `NEXT_PUBLIC_API_BASE_URL`.
- **Extraction**:
  - `OCR_SPACE_API_KEY`
  - `OPENROUTER_API_KEY`
  - `OPENROUTER_MODEL` (default `nvidia/nemotron-nano-9b-v2:free`)
  - `OPENROUTER_BASE_URL` (default `https://openrouter.ai/api/v1`)
  - `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME` (recommended)
- **Pathway**: `PATHWAY_BASE_URL` (optional)
- **Calendar**: `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID`

## 9) Operational Notes
- The API must have Firestore enabled in the selected Firebase project.
- Local dev:
  - Web: `npm run -w @medi/web dev` (port 3000)
  - API: `npm run -w @medi/api dev` (default port 4000)
  - Worker: `npm run -w @medi/worker dev`
- Port conflicts are common during iteration; ensure ports 3000 and 4000 are free.

## 10) Security & Privacy (MVP)
- Do not expose API keys in the frontend.
- Store secrets only in `.env` and never commit them.
- OCR/LLM calls contain medical text; in production, require secure storage, access controls, retention policies, and user consent.

## 11) Known Limitations
- Dummy vendors are simulated; real pharmacies will require robust integration and compliance.
- OCR quality varies; handwritten prescriptions may require stronger OCR or human-in-the-loop.
- Reminder sending is a placeholder (worker logs actions). Google Calendar events are the only “real” reminder side-effect in MVP.
