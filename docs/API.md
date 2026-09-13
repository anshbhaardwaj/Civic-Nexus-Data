# CivicData Nexus — API Reference

Backend for PS **SIH1682**. Express 4 + TypeScript + better-sqlite3, fully offline: no
network calls, no ML libraries, no pretrained models. Every number returned by an engine
carries its formula, inputs and source row ids.

- Base URL (dev): `http://localhost:5000`
- Auth: `Authorization: Bearer <jwt>` (HS256, 8 h TTL). `GET` endpoints that stream files
  also accept `?token=<jwt>` so links work in `<a download>`.
- Content type: `application/json` unless stated otherwise.
- **46 API routes** (list below) plus two non-API handlers: `GET /` (JSON service banner when
  `client/dist` is absent) and the SPA catch-all `GET /*` (serves `client/dist/index.html`
  when the frontend has been built).

## Error envelope

Every failure uses the same shape:

```json
{ "error": { "code": "FORBIDDEN", "message": "Role 'director' lacks permission 'datasets.delete'", "details": { } } }
```

| Status | Codes | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | malformed request body/params |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS` | missing/expired token, wrong password |
| 403 | `FORBIDDEN` | authenticated but the role lacks the permission |
| 404 | `NOT_FOUND` | unknown dataset/anomaly/user/route |
| 422 | `VALIDATION_ERROR` | Zod rejection (`details.issues`) or duplicate key |
| 422 | `NOT_APPLICABLE` | the engine cannot legitimately run on this data (e.g. forecasting a cross-sectional table) — never a crash |
| 500 | `INTERNAL_ERROR` | unexpected server error |

## Roles and permissions

`GET /api/auth/permissions` returns the machine-readable matrix. Summary:

| Permission | minister | analyst | director | auditor |
| --- | :-: | :-: | :-: | :-: |
| dashboard.view | ✓ | ✓ | ✓ | ✓ |
| datasets.read | ✓ | ✓ | ✓ | ✓ |
| datasets.ingest | | ✓ | | |
| datasets.delete | | ✓ | | |
| datasets.export | | ✓ | ✓ | ✓ |
| lineage.read | ✓ | ✓ | ✓ | ✓ |
| anomalies.read | ✓ | ✓ | ✓ | ✓ |
| anomalies.write | | ✓ | ✓ | |
| ai.run | | ✓ | ✓ | |
| policy.read | ✓ | ✓ | ✓ | |
| funds.optimise | ✓ | ✓ | ✓ | |
| simulate.run | ✓ | ✓ | ✓ | |
| brief.read | ✓ | ✓ | ✓ | ✓ |
| ask.run | ✓ | ✓ | ✓ | |
| audit.read | | ✓ | ✓ | ✓ |
| audit.export | | | | ✓ |
| users.admin | | | ✓ | |

Demo logins (all password `Demo@1234`): `minister@gov.in`, `analyst@gov.in`,
`director@gov.in`, `auditor@gov.in`.

---

## 1. Health

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | none | Always JSON 200: status, version, db path, boot report (datasets/rows/rejects/anomalies/policy cards), `pdfFonts`, `offline: true`. |

## 2. Auth — `/api/auth`

| Method | Path | Permission | Body / query | Returns |
| --- | --- | --- | --- | --- |
| POST | `/login` | none | `{email, password}` | `{token, expiresAt, user{id,email,name,role,permissions}}`; 401 on bad password, 422 on malformed body. Audited. |
| POST | `/logout` | authenticated | — | `{ok:true}`; audited (no server session is kept). |
| GET | `/me` | authenticated | — | current user + permissions |
| GET | `/demo-users` | none | — | the 4 seeded logins with passwords (evaluation build) |
| GET | `/permissions` | none | — | permission catalogue + role→permission map |

## 3. Datasets — `/api/datasets`

`:id` accepts either the numeric id or the slug (`ambulance_response`).

| Method | Path | Permission | Query / body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/` | datasets.read | — | all datasets with rows, columns, PII columns, rejects, quality score + totals |
| POST | `/ingest` | datasets.ingest | `{slug,name,domain?,description?,sourceFile?,format?,content}` | 201; runs the full 10-step pipeline on the uploaded CSV/JSON then rescans AI-1. Audited. |
| GET | `/:id` | datasets.read | — | dataset summary, columns, lineage summary, anomaly count, 5-row preview |
| GET | `/:id/columns` | datasets.read | — | per-column inferred type, semantic role, PII flag/kind, null count, min/max/mean/distinct |
| GET | `/:id/rows` | datasets.read | `limit`(1-1000, def 50), `offset`, `orderBy` | masked rows; 422 for an unknown `orderBy` |
| GET | `/:id/rejects` | datasets.read | — | rejected source rows with `reason_code` (`RAGGED_ROW`, `SCHEMA_VIOLATION`) and raw text |
| GET | `/:id/export-masked` | datasets.export | `format=csv\|json` | download of the cleaned table; PII columns contain salted-SHA-256 tokens only. Audited. |
| DELETE | `/:id` | datasets.delete | — | drops the `ds_*` table and the catalogue row. Audited. |

## 4. Lineage — `/api/lineage`

| Method | Path | Permission | Returns |
| --- | --- | --- | --- |
| GET | `/` | lineage.read | per-dataset step count, total duration, final row count |
| GET | `/:datasetId` | lineage.read | all 10 steps with `rowsIn`, `rowsOut`, `durationMs` and a JSON `detail` payload (inferred types, PII evidence, masking salt fingerprint, dedupe keys, reject samples) |

## 5. Anomalies — `/api/anomalies`

| Method | Path | Permission | Query / body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/` | anomalies.read | `datasetId`, `severity`, `status`, `limit`, `offset` | stored anomalies ordered by score |
| GET | `/summary` | anomalies.read | — | counts by severity, dataset and status + method note |
| GET | `/:id` | anomalies.read | — | one anomaly plus the full source row it came from |
| POST | `/:id/ack` | anomalies.write | — | sets `status=acknowledged`. Audited. |
| POST | `/:id/dismiss` | anomalies.write | — | sets `status=dismissed`. Audited. |

## 6. AI engines — `/api/ai`

| Method | Path | Permission | Query / body | Engine |
| --- | --- | --- | --- | --- |
| GET | `/engines` | policy.read | — | registry of all 8 engines, method strings, dataset inventory, MCDA weights |
| GET | `/anomalies` | anomalies.read | `dataset`, `limit` | **AI-1** live MAD/z/IQR detection (no persistence) |
| POST | `/anomalies/scan` | ai.run | `{dataset?}` | **AI-1** rescan + persist (replaces prior rows). Audited. |
| GET | `/isolation-forest` | ai.run | `dataset`, `trees`(10-300), `psi`(32-1024), `topN` | **AI-2** 100-tree isolation forest, `thresholdUsed`, per-feature ablation contributions, score histogram |
| GET | `/forecast` | ai.run | `dataset`, `metric`, `horizon`(1-5), `aggregation=sum\|avg`, `filterColumn`, `filterValue` | **AI-3** naive-drift / Holt-linear / seasonal-naive-drift, walk-forward MAPE model selection, 80/95 % intervals. 422 `NOT_APPLICABLE` for cross-sectional tables |
| GET | `/clusters` | ai.run | `dataset`, `dimension`, `k`(2-8), `aggregation` | **AI-4** k-means++ with silhouette-chosen k, centroids in original units, plain-English cluster labels |
| GET | `/correlation` | ai.run | `dataset`, `maxLag`(1-6) | **AI-5** Pearson + Spearman matrices with p-values, ranked pairs, spurious flags, lag-based leading indicators |
| GET | `/policy-cards` | policy.read | `sector`, `limit` | **AI-6** MCDA cards with 6 weighted criteria whose contributions reconcile to the 0-100 impact score |
| POST | `/policy-cards/refresh` | ai.run | — | regenerates cards from current data. Audited. |
| GET | `/optimise` | funds.optimise | `budgetCr` | **AI-7** 0/1-knapsack portfolio, rejected list with reasons, utilisation, Pareto frontier over 8 budget multiples |
| POST | `/ask` | ask.run | `{question}` | **AI-8** intent classification → entity resolution → engine execution → templated answer. Audited. |
| GET | `/ask/examples` | ask.run | `run=true\|false` | 10 worked example questions, optionally executed |

## 7. Policy simulator — `/api/simulate`

| Method | Path | Permission | Body / query | Returns |
| --- | --- | --- | --- | --- |
| POST | `/` | simulate.run | 7 optional levers: `budgetReallocationPct`, `hospitalBedsAdded`, `ambulancesAdded`, `staffHired`, `waterCapexPct`, `roadRepairCapexCr`, `enforcementIntensity` | measured baseline, 12 published assumptions, 9 outputs projected 3 years, headline. Audited. |
| GET | `/assumptions` | simulate.run | — | default levers, live baseline, all assumptions with source + formula, output formulas |

## 8. Live telemetry — `/api/live`

| Method | Path | Permission | Body | Returns |
| --- | --- | --- | --- | --- |
| POST | `/tick` | datasets.ingest | `{dataset?, spikeProbability?}` | appends one new period per entity drawn from that entity's recent mean/σ (with injected spikes), re-runs AI-1, returns before/after row counts and the new anomaly counts. Audited. |

## 9. Executive brief — `/api/brief`

| Method | Path | Permission | Returns |
| --- | --- | --- | --- |
| GET | `/preview` | brief.read | brief JSON: scope, 6 KPIs with formulas, top anomalies, top policy cards, optimiser portfolio, forecast headline, correlation headline, narrative sections, audit attestation, evidence notes |
| GET | `/pdf` | brief.read | `application/pdf` (3+ pages, ~38 kB) rendered with pdfkit + bundled Noto Sans so `₹` (U+20B9) renders. Audited. |

## 10. Audit — `/api/audit`

| Method | Path | Permission | Query | Returns |
| --- | --- | --- | --- | --- |
| GET | `/` | audit.read | `action`, `actor`, `limit`, `offset` | tamper-evident log entries, newest first |
| GET | `/verify` | audit.read | — | `{valid, entries, brokenAt, reason, headHash, algorithm}` — recomputes the whole hash chain |
| GET | `/export` | audit.export | — | JSON download of the full chain + verification result. Audited. |

## 11. Users — `/api/users`

| Method | Path | Permission | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/` | users.admin | — | users with role + permissions |
| POST | `/` | users.admin | `{email,name,role,password}` | 201 created; 422 on duplicate email. Audited. |
| PATCH | `/:id` | users.admin | `{name?,role?,active?,password?}` | updated user. Audited. |
| DELETE | `/:id` | users.admin | — | soft-deactivates (`active=0`); refuses self-deactivation. Audited. |

## 12. Dashboard — `/api/dashboard`

| Method | Path | Permission | Returns |
| --- | --- | --- | --- |
| GET | `/` | dashboard.view | current user + permissions, 10 headline KPIs, dataset inventory, anomalies by severity, top 5 policy cards, portfolio summary, audit-chain state, last 8 audit entries, role list |

---

## Audit-on-mutation

Every mutating call (login, logout, ingest, delete, export, anomaly ack/dismiss, AI scans,
policy refresh, ask, simulate, live tick, brief PDF, user create/update/deactivate, audit
export) appends one entry to the hash chain:

```
hash_i = SHA-256(prev_hash | seq | ts | actor | action | entity | SHA-256(payload_json))
```

`GET /api/audit/verify` recomputes the chain from the genesis hash (64 zeros) and reports
the first divergent sequence number if any row was altered.
