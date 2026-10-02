# CivicData Nexus

> **Offline, explainable decision intelligence for public-sector data.**

CivicData Nexus turns department data into evidence-backed decisions on a single machine. It ingests messy CSV or JSON files, protects personally identifiable information (PII), identifies risks, forecasts trends, ranks interventions, optimises a budget, simulates policy choices, and produces an executive PDF. Every important result retains its formula, inputs, and source-row evidence.

**Built for:** Smart India Hackathon PS SIH1682 — *Efficient Telemetry Analysis & Automated Decision Intelligence for Public Sector Data*.

## At a glance

| | |
| --- | --- |
| **Runtime** | Node.js 20+, one SQLite database file, no runtime network calls |
| **Interface** | React 18, TypeScript, Vite, Tailwind CSS, Recharts |
| **API** | Express 4 + TypeScript, 46 documented routes, Zod validation |
| **Analytics** | Eight explainable, hand-written decision engines |
| **Access** | Minister, analyst, director, and auditor roles with server-enforced permissions |
| **Evidence** | Lineage, masked exports, row-level explanations, and a tamper-evident audit chain |

## What problem does it solve?

Government data often lives in disconnected spreadsheets across health, water, roads, air quality, finance, and citizen services. Files can contain inconsistent headers, missing values, duplicate records, and PII. That slows analysis and makes decisions difficult to audit.

CivicData Nexus provides one offline workflow:

```text
Ingest data → clean and mask it → analyse it → rank actions → test choices → publish a brief → verify the trail
```

The platform is designed to make each step inspectable. It does not rely on a cloud model, a paid AI service, or hidden scoring logic.

## Core capabilities

### 1. Ingestion with a recorded cleaning pipeline

Upload CSV or JSON data through the analyst workflow. The ingestion service records these ten stages for every dataset:

1. Parse source data
2. Normalise headers
3. Infer data types
4. Infer semantic roles
5. Detect PII
6. Mask PII
7. Impute missing values
8. Deduplicate records
9. Validate the schema
10. Persist clean data, rejects, and lineage

The platform preserves rejected rows with reasons and records row counts and duration for each step. Nothing disappears silently.

### 2. Privacy-first data handling

PII detection considers both column headers and values. Sensitive values are replaced with deterministic, per-dataset salted SHA-256 tokens. The same source value maps to the same safe token within a dataset, which preserves valid joins without exposing the original value. Masked data exports are available only to authorised roles.

### 3. Explainable analytics

Every engine exposes the method, inputs, and evidence behind its output.

| Engine | Purpose | Method |
| --- | --- | --- |
| **AI-1 · Anomaly finder** | Flags unusual metric values | Median absolute deviation, z-score, and IQR agreement |
| **AI-2 · Isolation forest** | Finds unusual rows across multiple metrics | Seeded isolation forest with feature-ablation explanations |
| **AI-3 · Forecaster** | Predicts one to five future periods | Walk-forward selection across naïve drift, Holt linear, and seasonal naïve drift |
| **AI-4 · District grouper** | Groups similar districts or entities | k-means++ with silhouette-based model selection |
| **AI-5 · Correlation linker** | Surfaces relationships and leading indicators | Pearson and Spearman correlation, p-values, and lag analysis |
| **AI-6 · Action ranker** | Scores candidate interventions | Six-criterion multi-criteria decision analysis (MCDA) |
| **AI-7 · Fund optimiser** | Selects actions within a budget | Exact 0/1-knapsack dynamic programming and Pareto frontier |
| **AI-8 · Ask CivicData** | Answers supported questions offline | Keyword intent detection, entity resolution, and deterministic templates |

### 4. Decision tools for leaders

- **Policy cards** show an action’s cost, impact score, score contributions, and evidence.
- **Fund optimiser** derives a spending envelope and selects the highest-impact portfolio within it.
- **Policy simulator** applies seven configurable levers to a three-year model and displays the assumptions and formulas used.
- **Executive brief** exports the current analysis as a multi-page PDF with embedded Noto Sans fonts for reliable ₹ rendering.

### 5. Trust and governance

- JWT-based authentication with role and permission checks on every protected API route.
- Passwords hashed with Node.js `scrypt` and compared in constant time.
- Every mutation added to a hash-linked audit trail.
- Audit verification identifies the first broken entry if historical data changes.
- Query identifiers are validated before reaching SQLite.

## Quick start

### Prerequisites

- Node.js **20 or newer**
- npm

### Run locally

```bash
npm install
npm run dev
```

The API starts at [http://localhost:5000](http://localhost:5000). On first boot it creates `data.db`, seeds the demo users and datasets, scans for anomalies, and generates policy cards.

In a second terminal, start the React development server:

```bash
npm run dev:client
```

Open [http://localhost:5173](http://localhost:5173). During development, the client calls the API on port `5000` automatically.

### Demo accounts

All seeded demo accounts use the password `Demo@1234`.

| Role | Email | Intended use |
| --- | --- | --- |
| Minister | `minister@gov.in` | Review priorities, optimiser outputs, simulations, and briefs |
| Analyst | `analyst@gov.in` | Ingest data, run engines, investigate findings |
| Director | `director@gov.in` | Review analysis and administer users |
| Auditor | `auditor@gov.in` | Verify and export the audit trail in read-only mode |

> These accounts are for the demonstration build only. Replace them before any real deployment.

## Production build

Build the server and client into a single deployable application:

```bash
npm run build
npm start
```

After the client has been built, Express serves `client/dist` and the API from the same process at [http://localhost:5000](http://localhost:5000).

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5000` | HTTP port for the Express application |
| `DB_PATH` | `./data.db` at the project root | SQLite database location |
| `VITE_API_BASE` | empty | Optional API base URL for a separately hosted frontend |

Example:

```bash
PORT=5050 DB_PATH=/var/lib/civicdata/data.db npm start
```

## Verify the build

```bash
npm run typecheck
npm run build
```

For end-to-end API verification, start the server on port `5000` first, then run:

```bash
npm run verify
```

The verification script exercises authentication, role boundaries, datasets, PII-safe exports, all eight engines, the simulator, live telemetry, PDF generation, audit integrity, and user administration. It creates temporary verification data and performs a live-tick mutation, so use a disposable database if you need to preserve a particular local state:

```bash
DB_PATH=/tmp/civicdata-verify.db npm run dev
# In another terminal:
npm run verify
```

## Seed datasets

The demo build includes deterministic, synthetic datasets designed to resemble public-sector telemetry:

| Dataset | Domain |
| --- | --- |
| `scheme_expenditure` | Scheme expenditure and fund utilisation |
| `hospital_capacity` | Hospital capacity |
| `ambulance_response` | Emergency ambulance response |
| `bridge_health` | Bridge condition |
| `water_supply` | Water supply |
| `air_quality` | Air quality |
| `traffic_congestion` | Traffic congestion |
| `citizen_grievances` | Citizen grievance resolution |

Ensure the deterministic seed CSVs are present:

```bash
npm run seed
```

The generators use seeded randomness so the same source data is reproduced consistently. Existing seed files are left unchanged by default.

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│ React client                                                     │
│  Dashboard · ingestion · analytics · simulator · brief · audit  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP + JWT
┌───────────────────────────────▼─────────────────────────────────┐
│ Express API                                                      │
│  validation · RBAC · ingestion · 8 engines · PDF · audit         │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│ SQLite (WAL mode)                                                │
│  catalogue · dataset tables · lineage · anomalies · policy cards │
│  users · audit log                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Project structure

```text
client/                 React application and route-level pages
  src/pages/            Dashboard, datasets, engines, brief, audit, and more
  src/components/       Shared UI, navigation, charts, and application shell
server/
  ai/                   Explainable analytics engines
  routes/               Auth, datasets, analytics, and operations endpoints
  lib/                  Ingestion, security, audit, simulation, PDF, statistics
  db.ts                 SQLite schema and database helpers
seed/                   Deterministic synthetic source datasets
docs/API.md             Full API reference
verify.sh               End-to-end route verification
```

## API and health checks

The unauthenticated health endpoint is useful for local and deployment checks:

```bash
curl http://localhost:5000/api/health
```

See [docs/API.md](docs/API.md) for request formats, authentication, permissions, error responses, and every supported endpoint.

## Current limitations

- The bundled datasets are **synthetic**. They support product demonstration and repeatable testing, not claims about observed government outcomes.
- The simulator produces projections from published assumptions. Validate them with field data before using them for public policy.
- The analytics engines are implemented from classical methods without ML libraries. They prioritise inspectability over library-grade optimisation.
- SQLite is appropriate for this single-machine prototype. Very large ingestions run synchronously; a production scale-out should add background jobs and a server database such as PostgreSQL.
- Tokens are stateless and expire after eight hours. A production deployment should add refresh tokens and revocation.
- The live telemetry action intentionally changes the selected dataset and can affect row counts and anomaly IDs.

## License

MIT. See [`package.json`](package.json) for the project licence declaration.

---

**CivicData Nexus gives public-sector teams a faster path from raw files to explainable, auditable action — fully offline.**
