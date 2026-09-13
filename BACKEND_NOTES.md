# CivicData Nexus — Backend Notes (measured)

Backend half of the SIH1682 build: Express 4 + TypeScript + better-sqlite3, Zod validation,
pdfkit. No network access at runtime, no ML libraries, no pretrained models — all eight AI
engines are hand-implemented in `server/ai/`. The React client is **not** part of this work;
`server/index.ts` serves `client/dist` when the frontend agent has built it, and otherwise
returns a JSON service banner on `/` while `/api/health` always answers 200.

Everything below is output measured on this machine (Node v20.20.1), not an estimate.

## 1. Type check

```
$ npx tsc --noEmit
(no output, exit 0)
```

## 2. Cold boot from an empty database

`rm -f data.db data.db-wal data.db-shm` then `npm run dev`:

```
[civicdata-nexus] API listening on http://localhost:5000 — 8 datasets, 6436 rows,
108 anomalies, 31 policy cards (boot 484ms, db /home/user/workspace/civicdata-nexus/data.db)
```

Boot is idempotent: `initSchema()` → `seedUsers()` (4 demo roles) → `ingestSeedDatasets()`
(skips datasets already present) → AI-1 scan only when `anomalies` is empty → AI-6 refresh
only when `policy_cards` is empty. A second boot re-ingests nothing (`ingestedThisBoot: 0`)
and still reports the same live totals via `GET /api/health`.

## 3. Seed generators (`npx tsx server/lib/seedgen.ts`)

```
OK  scheme_expenditure.csv        1008 rows (min 900)
OK  hospital_capacity.csv          840 rows (min 800)
OK  ambulance_response.csv         840 rows (min 800)
OK  bridge_health.csv              520 rows (min 500)
OK  water_supply.csv               756 rows (min 700)
OK  air_quality.csv                756 rows (min 700)
OK  traffic_congestion.csv         756 rows (min 700)
OK  citizen_grievances.csv         960 rows (min 900)
```

All generators are deterministic (mulberry32 seeded per file), so regenerating produces
byte-identical CSVs. `bridge_health.csv` contains exactly **471** bridges with
`ibms_rating < 75`, matching the MoRTH/IBMS distressed-bridge figure. Three of the eight
files also carry 3 deliberately malformed trailing lines (short row, extra cell, non-numeric
value in a numeric column) so the pipeline's reject path is exercised with real data.

## 4. Ingestion pipeline, as recorded in lineage

`GET /api/lineage/citizen_grievances` (durations from the cold boot above):

```
1  parse                     ok  963->961   4ms
2  header_normalisation      ok  961->961   0ms
3  type_inference            ok  961->961   4ms
4  semantic_role_inference   ok  961->961   2ms
5  pii_detection             ok  961->961   0ms
6  pii_masking               ok  961->961  23ms
7  imputation                ok  961->961   1ms
8  deduplication             ok  961->960   1ms
9  schema_validation         ok  960->960   0ms
10 persist                   ok  960->960   8ms
```

Catalogue after boot (`GET /api/datasets`): `{"datasets":8,"rows":6436,"piiColumnsMasked":4,"rejects":8}`

| slug | rows | cols | PII cols | rejects | quality |
| --- | --- | --- | --- | --- | --- |
| scheme_expenditure | 1008 | 10 | 0 | 0 | 100 |
| hospital_capacity | 840 | 8 | 0 | 3 | 99.6 |
| ambulance_response | 840 | 7 | 0 | 0 | 100 |
| bridge_health | 520 | 9 | 0 | 0 | 100 |
| water_supply | 756 | 7 | 0 | 3 | 99.6 |
| air_quality | 756 | 7 | 0 | 0 | 100 |
| traffic_congestion | 756 | 6 | 0 | 0 | 100 |
| citizen_grievances | 960 | 12 | 4 | 2 | 96.9 |

Quality score = `100 × (1 − missing/cells) × (1 − rejects/sourceRows) × (1 − dupes/parsedRows)`.

## 5. PII masking — before and after

Raw seed line (`seed/citizen_grievances.csv`, line 2):

```
GRV-2023-100000,Education,Patna,2023-08-18,2023-10-03,46,Scheme payment pending,
Ananya Reddy,+919285551533,ananya.reddy90@yahoo.in,217860847314,Closed
```

Ingested row (`GET /api/datasets/citizen_grievances/rows?limit=1`):

```json
{"row_id":1,"ticket_id":"GRV-2023-100000","department":"Education","district":"Patna",
 "opened_on":"2023-08-18","closed_on":"2023-10-03","days_to_close":46,
 "category":"Scheme payment pending","citizen_name":"K42U0F1OQC6TL4",
 "citizen_phone":"D2S5UTB5C0IXSF","citizen_email":"A556OZBQ7266WU",
 "aadhaar_ref":"Y4IDVXP86C0UTH","status":"Closed"}
```

Masked export assertions (`GET /api/datasets/citizen_grievances/export-masked`):

```
masked export: 961 lines, 12-digit runs=0, emails=0, phone-shaped=0
```

Tokens are `base36(SHA-256(datasetSalt | column | value))`, uppercased, letter-prefixed,
≤14 chars — deterministic (joins still work), irreversible, never numeric-looking. Original
values are never written to disk.

## 6. Route verification — 73/73 checks pass

`bash verify.sh` against a freshly booted database exercises **all 46 API routes** plus the
mandated negative cases. Final line:

```
PASS=73 FAIL=0
```

Highlights from the run:

```
PASS assert  login minister returns a JWT           (also analyst, director, auditor)
PASS 401 POST /api/auth/login          bad password rejected
PASS 401 POST /api/auth/login          unknown user rejected
PASS 401 GET  /api/dashboard           missing token rejected
PASS 422 POST /api/auth/login          malformed login validated
PASS 403 GET  /api/ai/forecast         auditor forbidden from ai.run
PASS 403 GET  /api/audit               minister forbidden from audit log
PASS 403 GET  /api/users               analyst forbidden from user admin
PASS 403 DELETE /api/datasets/air_quality  director cannot delete datasets
PASS 422 GET  /api/ai/forecast?dataset=bridge_health   AI-3 not applicable on cross-section
PASS 422 GET  /api/datasets/water_supply/rows?orderBy=nope   bad order column
PASS 404 GET  /api/datasets/not_a_dataset / /api/anomalies/999999 / /api/does-not-exist
PASS assert  brief pdf starts with %PDF
PASS assert  brief pdf larger than 20 kB (got 38391B)
PASS assert  brief pdf renders the ₹ glyph (U+20B9)     (pdftotext finds 23 occurrences)
PASS assert  brief pdf is multi-page (got 3)
PASS assert  audit chain valid:true
PASS assert  masked export has 0 twelve-digit runs / 0 email-shaped values / 0 phone-shaped values
```

The full transcript of the last run is reproducible with `npm run verify` (server must be
running on port 5000); output is also kept at `/tmp/verify-final.txt` in this sandbox.

## 7. Engine outputs actually measured

**AI-1 (MAD/z/IQR)** — 108 anomalies at boot; example entry:

> `avg_response_min = 58.71 for Pune in 2026-01. Robust baseline (group 'Pune', n=85):
> median 20.8, scaled MAD 1.334, so expected band 16.13..25.47. Deviation 37.909 =
> 28.41σ_MAD; z-score 7.3 (flags), IQR rule flags → 3/3 detectors agree.`
> (severity `critical`, `source_row_id` 841 — the row appended by the live-tick test.)

**AI-3 (forecast, `ambulance_response.avg_response_min`, avg aggregation)** — walk-forward
selection over 34 folds:

```
holt-linear           MAPE 4.904 %  (in-sample 4.500)  ← chosen
seasonal-naive-drift  MAPE 5.158 %  (in-sample 12.649)
naive-drift           MAPE 5.449 %  (in-sample 4.555)
step 5 → 2026-06: 19.477 (80% 16.793–22.161, 95% 15.373–23.582)
```

**AI-6 / AI-7** — 31 policy cards; derived envelope
`min(35% of measured idle capital ₹1,28,566.86 cr, 60% of the total ask)` = ₹8,743.01 cr.
The knapsack selects 29 of 31 cards for ₹7,233.36 cr (82.7 % utilisation, total impact
1925.53) and reports each rejection, e.g. `PC-015-BRG-MAHARASHTRA` (impact 52.89,
₹3,699.97 cr) — "excluded by the DP optimum — displacing a selected item would lower total
impact".

**AI-8 (ask)** — `"Which district has the worst ambulance response time?"`:

> Ranking districts by avg(avg response min) in 'Emergency Ambulance Response' (highest
> first): 1. Pune — 21.49; 2. Aurangabad — 17.36; 3. Jaipur — 14.96; 4. Gorakhpur — 14.61;
> 5. Varanasi — 14.13. Computed over 10 groups and 850 ingested rows.

Intent `rank` from keywords `worst`, `which district`; the response also echoes tokens,
intent scores and the SQL-level aggregation used.

**Audit chain** — `GET /api/audit/verify` after the verification run:

```json
{"valid":true,"entries":40,"brokenAt":null,"reason":null,
 "headHash":"bfddf2145d1c76b107fce84c177161f1cbc12f584d1efeba821f33c93b5ac9b2",
 "algorithm":"SHA256(prevHash|seq|ts|actor|action|entity|payloadHash)"}
```

**Executive brief PDF** — 3 pages, 38,391 bytes, `%PDF` magic bytes, Noto Sans embedded from
`server/assets/fonts/`; `pdftotext` extracts strings such as `₹1,28,566.86 cr of released
funds remain unspent — utilisation stands at 67.42%.`

## 8. Known limitations

1. **No ML libraries by design.** The isolation forest, k-means, Holt smoothing, MAD/z/IQR
   detectors, correlation statistics and knapsack solver are hand-written. They are correct
   implementations of the classical algorithms but not tuned to library-grade performance;
   for example the p-values come from an incomplete-beta approximation rather than an exact
   distribution routine.
2. **Seed data is synthetic.** Row values are generated deterministically to resemble Indian
   public-sector telemetry and are anchored on published figures where one exists (471
   distressed NH bridges, CAG unspent-fund ratios). They must not be quoted as observed
   government statistics; the brief labels the ~4.2-minute ambulance improvement as a team
   projection.
3. **Forecasting refuses cross-sectional data.** `bridge_health` has an inspection-date
   column, so AI-3 returns 422 `NOT_APPLICABLE` (over 50 % of rows would be their own
   period). This is intended behaviour, not a bug, and the payload names the alternatives.
4. **JWT is stateless.** `POST /api/auth/logout` only records an audit entry; a stolen token
   stays valid until its 8-hour expiry. There is no refresh-token flow or revocation list.
5. **Single-process SQLite.** WAL mode handles concurrent readers, but the ingestion,
   `POST /api/live/tick` and AI rescans run synchronously in the request; a very large upload
   will block the event loop for its duration (the 6,436-row seed set takes ~0.5 s in total).
6. **Live tick mutates the dataset.** Each call appends a real period to the ingested table
   and re-runs AI-1, so anomaly ids and row counts change between calls; there is no undo
   other than deleting `data.db` and rebooting.
7. **`npm run build` skips the client** until `client/index.html` exists
   (`scripts/build-client.mjs` exits 0 with a notice), so the backend build never fails on
   the missing frontend. Once the client is built, production `npm start` serves
   `client/dist` with an SPA catch-all.
8. **Users cannot be hard-deleted.** `DELETE /api/users/:id` deactivates
   (`active = 0`) to keep audit references intact, and refuses self-deactivation.

## 9. Production build check

```
$ npm run build
> tsc -p tsconfig.json
[build-client] client/index.html not found — skipping client build (API-only build).

$ PORT=5055 DB_PATH=/tmp/prodtest.db node dist/server/index.js
[civicdata-nexus] API listening on http://localhost:5055 — 8 datasets, 6436 rows,
108 anomalies, 31 policy cards (boot 407ms, db /tmp/prodtest.db)
```

The compiled server resolves `data.db`, `seed/` and `client/dist` from the project root
(located by walking up to `package.json`), and the brief PDF still embeds Noto Sans from
`server/assets/fonts` — `pdftotext` finds 24 `₹` occurrences in the PDF produced by
`dist/server/index.js`. `verify.sh` was re-run after these path changes: **73/73 pass**.
