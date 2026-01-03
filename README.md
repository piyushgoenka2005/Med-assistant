# Medi Platform (MVP)

End-to-end MVP for prescription upload → AI extraction → cart confirmation → Cash on Delivery → pharmacy order → reminders/follow-ups.

## Local setup

### 1) Requirements

- Node.js 20+

### 2) Configure env

Copy `.env.example` to `.env`.

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

For Firebase Firestore, set **either**:

- `GOOGLE_APPLICATION_CREDENTIALS` pointing to your Firebase service account JSON, or
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

Note: If you use inline private keys, keep newlines escaped as `\n` (see `.env.example`).

### 3) Install deps

```bash
npm install
```

### 4) Run the system

In separate terminals:

```bash
npm run -w @medi/api dev
```

```bash
npm run -w @medi/worker dev
```

```bash
npm run -w @medi/web dev
```

Open `http://localhost:3000`.

## Notes

- MCP/AI extraction is implemented as an adapter with a mock extractor by default.
- Payment is Cash on Delivery (COD) in this MVP.
- Cart pricing uses 3 dummy vendor pages served by the API under `/dummy/site-a|site-b|site-c` and selects the lowest total.
- Optional: set `PATHWAY_BASE_URL` to have the API call a Pathway-compatible `/quote` endpoint for real-time totals.
- Reminders/check-ins create Google Calendar events (if configured) after a successful COD order placement.
