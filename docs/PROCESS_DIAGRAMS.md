# Medi Platform — Structured Diagrams (Mermaid)

This document contains ready-to-render diagrams (Mermaid) that explain the system end-to-end and also cover the evaluation topics from your image:
- Technical Feasibility
- Market Analysis
- Business Model
- Revenue Generation
- Innovation
- Implementation
- Overall Project Complexity
- Novelty
- Uniqueness
- Overall Feasibility

> Tip: Mermaid diagrams render in GitHub, many Markdown previewers, and VS Code extensions.

---

## 1) End-to-End System Process (Core)

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant W as Web (Next.js)
  participant A as API (Fastify)
  participant F as Firestore
  participant O as OCR.space
  participant R as OpenRouter LLM
  participant P as Pathway (optional)
  participant V as Dummy Vendors
  participant C as Google Calendar (optional)
  participant K as Worker

  U->>W: Select file + patient details
  W->>A: POST /v1/uploads/prescription (multipart)
  A->>A: Validate file type, store to disk
  A->>F: Create uploads + prescriptions (+ customers)
  A->>O: OCR file (PDF/Image)
  O-->>A: OCR text
  A->>R: Analyze OCR text → JSON
  R-->>A: Structured JSON
  A->>F: Write extractions, update prescription=EXTRACTED
  W->>A: GET /v1/prescriptions/:id
  A-->>W: Prescription + extraction

  U->>W: Confirm & Build Cart
  W->>A: POST /v1/prescriptions/:id/confirm
  A->>V: Query offers from 3 vendors (HTML/JSON)
  alt PATHWAY_BASE_URL set
    A->>P: Quote totals per vendor
    P-->>A: Real-time totals
  end
  A->>F: Write carts/{id} with selected vendor + pricing
  A-->>W: Cart

  U->>W: Place order (COD)
  W->>A: POST /v1/orders/cod
  A->>V: Recompute offers + purchase from selected vendor
  A->>F: Write orders + vendorOrderId
  A->>F: Schedule reminders
  opt Calendar configured
    A->>C: Create events
    C-->>A: event ids
    A->>F: Store event ids in reminders payload
  end

  loop Poll due reminders
    K->>F: Query reminders dueAt<=now
    F-->>K: Due reminders
    K->>K: Send (MVP placeholder)
    K->>F: Update reminder status/attempts
  end
```

---

## 2) Technical Feasibility

### 2.1 Architecture feasibility (components and dependencies)
```mermaid
flowchart TB
  subgraph Client
    W[Web UI\nNext.js]
  end

  subgraph Backend
    A[API\nFastify]
    K[Worker\nNode/TS]
  end

  subgraph Storage
    F[(Firestore)]
    S[(Local disk\nUPLOAD_DIR)]
  end

  subgraph External
    O[OCR.space]
    R[OpenRouter LLM]
    P[Pathway\n(optional)]
    C[Google Calendar\n(optional)]
  end

  W -->|HTTP| A
  A --> S
  A --> F
  K --> F
  A --> O
  A --> R
  A --> P
  A --> C

  style P stroke-dasharray: 5 5
  style C stroke-dasharray: 5 5
```

### 2.2 Feasibility checkpoints
```mermaid
flowchart LR
  A[OCR quality] --> B[LLM JSON validity]
  B --> C[Cart build success]
  C --> D[Vendor selection]
  D --> E[Order placement]
  E --> F[Reminder scheduling]
```

---

## 3) Market Analysis

### 3.1 Stakeholder map
```mermaid
mindmap
  root((Medi Platform))
    Patients
      Chronic meds
      Elderly care
      Busy professionals
    Pharmacies
      Local chains
      Delivery providers
    Doctors
      Prescriptions
      Follow-ups
    Caregivers
      Family members
      Nurses
    Regulators
      Data privacy
      Medical compliance
```

### 3.2 Value chain (where the product sits)
```mermaid
flowchart LR
  RX[Prescription issued] --> OCR[Digitization/OCR]
  OCR --> Parse[Structured extraction]
  Parse --> Compare[Price + availability compare]
  Compare --> Order[Order placement]
  Order --> Delivery[Delivery]
  Delivery --> Adherence[Reminders + check-ins]
```

---

## 4) Business Model

### 4.1 Business model blocks (high-level)
```mermaid
flowchart TB
  V[Value Proposition]\n"Fast prescription-to-order" 
  C[Customer Segments]\nPatients & caregivers
  P[Partners]\nPharmacies, logistics, OCR/LLM providers
  R[Revenue]\nCommission, subscription, SaaS
  K[Key Activities]\nExtraction, vendor selection, ordering, reminders
  S[Costs]\nOCR/LLM usage, infra, support

  V --> C
  V --> P
  V --> K
  R --> V
  S --> K
```

---

## 5) Revenue Generation

```mermaid
flowchart LR
  A[Per-order commission] --> R((Revenue))
  B[Subscription\n(patients/caregivers)] --> R
  C[SaaS licensing\n(to pharmacies/clinics)] --> R
  D[Premium reminders\n(voice + adherence)] --> R
  E[Analytics (aggregated)\nB2B reporting] --> R
```

---

## 6) Innovation

### 6.1 “Automation loop” innovation: extraction → compare → purchase → adherence
```mermaid
flowchart LR
  X[OCR + LLM extraction] --> Y[Vendor compare\n(3 sources)]
  Y --> Z[Auto purchase\n(COD)]
  Z --> A[Adherence reminders\n(Calendar + worker)]
  A --> X
```

### 6.2 What is “new” in the MVP
```mermaid
flowchart TB
  E[Explainable extraction\n(JSON + confidence)] --> I[Auto cart build]
  I --> Q[Real-time quote\n(Pathway optional)]
  Q --> P[Vendor purchase + history]
  P --> R[Reminders after order]
```

---

## 7) Implementation

### 7.1 Implementation phases
```mermaid
flowchart LR
  P0[Phase 0\nMVP scaffold] --> P1[Phase 1\nFirestore + upload]
  P1 --> P2[Phase 2\nOCR + LLM extraction]
  P2 --> P3[Phase 3\nCart + vendor selection]
  P3 --> P4[Phase 4\nCOD + vendor purchase]
  P4 --> P5[Phase 5\nReminders + Calendar]
```

### 7.2 Prescription lifecycle state machine
```mermaid
stateDiagram-v2
  [*] --> UPLOADED
  UPLOADED --> EXTRACTED: Extraction completed
  EXTRACTED --> CONFIRMED: User confirms
  CONFIRMED --> ORDERED: COD order placed
  ORDERED --> [*]

  state ORDERED {
    [*] --> PLACED_WITH_PHARMACY
  }
```

---

## 8) Overall Project Complexity

```mermaid
flowchart TB
  UI[UI complexity\nMedium] --> T((Overall Complexity))
  API[API complexity\nMedium-High] --> T
  DATA[Data model\nMedium] --> T
  EXT[External integrations\nHigh] --> T
  OPS[Operations\nMedium] --> T

  EXT -->|OCR + LLM + Calendar + optional Pathway| OPS
```

---

## 9) Novelty

```mermaid
flowchart LR
  N1[Many apps: upload + manual cart] --> N2[Medi: extraction + auto cart]
  N2 --> N3[Medi: vendor auto purchase + adherence]
```

---

## 10) Uniqueness

```mermaid
flowchart TB
  U1[Single flow: RX → Order] --> U((Uniqueness))
  U2[Real-time vendor selection] --> U
  U3[Vendor order history reflection] --> U
  U4[Post-order reminders + check-ins] --> U
```

---

## 11) Overall Feasibility

```mermaid
flowchart LR
  A[Technical feasibility] --> F((Overall Feasibility))
  B[Market need] --> F
  C[Business model viability] --> F
  D[Operational feasibility] --> F
  E[Regulatory path] --> F
```

### 11.1 Risk register (visual)
```mermaid
flowchart TB
  R1[OCR errors] --> M1[Mitigation: fallback + human review]
  R2[LLM hallucination] --> M2[Mitigation: strict schema + confidence]
  R3[Vendor integration variability] --> M3[Mitigation: adapters + monitoring]
  R4[Data privacy/compliance] --> M4[Mitigation: access controls + consent]
  R5[Costs of OCR/LLM] --> M5[Mitigation: caching + tiered plans]
```
