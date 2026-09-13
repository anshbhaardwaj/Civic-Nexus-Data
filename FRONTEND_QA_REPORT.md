# CivicData Nexus — Frontend QA Report

Team CivicNexus · SIH 2026 · PS SIH1682
Frontend: Vite 7 + React 18 + TypeScript (strict) + Tailwind 3 + Recharts + HashRouter, served by the same Express process on port 5000.

Everything below was measured on this host against the live API (8 seeded datasets, 6,485 rows after the live-tick flow, 146 anomalies, 31 policy cards). No figure in this report is estimated.

---

## 1. Test harness

| Harness | File | What it does |
| --- | --- | --- |
| Route smoke test | `../qa-tools/smoke.mjs` | Loads all 20 routes as director, reports body-text length, page errors, console errors |
| Screenshot + assertion sweep | `../qa-tools/shots.mjs` | 190 screenshots (19 routes × 10 role/theme/width combinations) with 7 automated assertions per screenshot |
| Interaction click-through | `../qa-tools/interactions.mjs` | 19 scripted user journeys, 16 extra screenshots + a downloaded PDF |
| Overflow probes | `../qa-tools/dbg-overflow.mjs`, `../qa-tools/dbg-narrow.mjs` | Pinpoint the exact DOM node causing a horizontal overflow at a given viewport |
| Simulator probe | `../qa-tools/dbg-sim.mjs` | Traces `/api/simulate` requests while dragging levers |

Playwright 1.59.0 with the cached Chromium 1217 build. Raw outputs: `../qa-tools/shot-violations.json`, `../qa-tools/interaction-results.json`, `../qa-tools/shots.log`.

### Screenshot matrix — 190 shots, all in `qa-screenshots/`

| Role | Viewports | Themes | Routes | Shots |
| --- | --- | --- | --- | --- |
| director | 1280 × 900 and 375 × 780 | dark + light | 19 | 76 |
| minister | 1280 × 900 | dark + light | 19 | 38 |
| analyst | 1280 × 900 | dark + light | 19 | 38 |
| auditor | 1280 × 900 | dark + light | 19 | 38 |

Naming: `<role>-<theme>-<width>-<route>.png`. Every shot is `fullPage`. `qa-screenshots/` also holds 16 `flow-*.png` interaction shots and `brief-download.pdf`, for **207 files** in total (37 MB).

The 19 route screenshots per pass cover all 20 SPEC §8 routes: `/login` is captured implicitly in the four `flow-login-*.png` shots (a logged-in session cannot render the login route), and `dashboard, datasets, datasets/:id, ingest, lineage, anomalies, engines, forecast, isolation-forest, clusters, correlation, policy-cards, funds, ask, simulate, brief, audit, users, *` are each captured directly.

### Assertions run on every one of the 190 screenshots

1. **No raw JSON** — main content must not match `{"key":` or `[{"`.
2. **No unexplained empty state** — main content text must exceed 240 characters.
3. **No crash markers** — no `Something went wrong`, `TypeError`, `undefined is not`, `NaN`.
4. **No document overflow** — `scrollingElement.scrollWidth ≤ innerWidth + 2`.
5. **No element overflow** — no non-scrollable block whose `scrollWidth` exceeds its `clientWidth` by more than 3 px (tables inside their own scroller and SVG excluded).
6. **No clipped text** — no `overflow: hidden` leaf whose `scrollHeight` exceeds its `clientHeight` without an ellipsis.
7. **No double ₹/cr and no unformatted long numbers** — per text node: no `₹₹`, `cr cr`, `crore cr`, no money token carrying two magnitude suffixes, and no run of 6+ digits outside hash/monospace elements.
8. Plus `pageerror` and `console.error` capture for the whole navigation.

**Final result: 190 screenshots, 0 assertion violations, 0 page errors, 0 console errors.**

---

## 2. Interaction click-through — 19/19 passing

Measured on the final build (`../qa-tools/interaction-results.json`):

| Journey | Evidence |
| --- | --- |
| Four one-click demo logins | role badge read back as `minister`, `analyst`, `director`, `auditor` — `flow-login-*.png` |
| Ingest a CSV from `seed/` | `seed/air_quality.csv` uploaded as `qa_flow_air` through the 10-step pipeline, result panel rendered 1,422 chars of step detail — `flow-ingest-result.png` |
| Live tick changes anomalies | anomaly KPIs moved 141 → 150 datasets-affected/critical 63 → 70 on the first run and 70 → 84 critical on the second — `flow-live-tick.png` |
| Acknowledge an anomaly | toast `Anomaly #297 acknowledged … the state change is now an audit-chain entry` — `flow-anomaly-ack.png` |
| Move simulator levers | headline changed from `With 15% of ₹1.29L cr idle capital reallocated, 600 beds…` to `With 45% of ₹1.29L cr idle capital reallocated, 2500 beds…` — `flow-simulate-levers.png` |
| Download the brief PDF | 38,129 bytes, magic `%PDF-`, filename `civicdata-nexus-executive-brief.pdf` — saved as `qa-screenshots/brief-download.pdf` |
| Run audit verify | `Chain verified — 262 entries recompute exactly` — `flow-audit-verify.png` |
| Three natural-language questions | rank, trend and correlation intents all answered from the live tables — `flow-ask-q1..q3.png` |
| Theme toggle | `html.dark` → `html` (light) and back |
| Sidebar collapse | collapse/expand round trip — `flow-sidebar-collapsed.png` |
| Dataset switcher | selection changed to `ambulance_response` and pages re-ran once |
| Forecast NOT_APPLICABLE recovery | 6 one-click switch buttons offered, chart present after switching — `flow-forecast-not-applicable.png`, `flow-forecast-recovered.png` |
| RBAC denial | minister on `/ingest` renders the explicit denied state, not a blank page — `flow-denied-minister-ingest.png` |

---

## 3. Defects found and fixed

Every item was found by the harness above, fixed, and re-verified by re-running the harness.

### D1 — Simulator levers had no effect (functional, severity: high)

- **Symptom:** dragging any of the 7 levers left the headline and all 9 outputs unchanged; `POST /api/simulate` returned 200 every time.
- **Diagnosis:** the client posted `{ levers: {...} }`, but the server's Zod schema (`server/routes/ops.ts`, `leverSchema`) takes the seven lever fields at the **body root** and strips unknown keys — so every request silently simulated the default scenario. Confirmed with a direct `curl` returning `levers: {budgetReallocationPct: 15, hospitalBedsAdded: 600, …}` for a body asking for 45 % and 2,500 beds.
- **Fix:** `client/src/pages/Simulate.tsx` now posts the lever object itself.
- **Evidence after fix:** headline `With 45% of ₹1.29L cr idle capital reallocated, 2500 beds …`; interaction check `simulate:levers-change-output` PASS. This was a client bug — **no server code was modified anywhere in this task.**

### D2 — Horizontal page overflow on Funds at 1280 (layout, severity: high)

- **Symptom:** `document.scrollWidth` 1,548 px against a 1,280 px viewport; the Pareto card was pushed 267 px off-screen.
- **Diagnosis:** CSS grid children default to `min-width: auto`, so the wide portfolio table refused to shrink inside `xl:grid-cols-[1.25fr_1fr]`.
- **Fix:** `client/src/styles.css` — `.grid > * { min-width: 0 }`, a single systemic rule instead of per-page patches.
- **Evidence:** Funds now reports `docScroll 1280 / win 1280`; the same rule also removed latent overflow risk on Brief, Simulate and Anomalies.

### D3 — Horizontal page overflow on Anomalies at 375 (layout, severity: high)

- **Symptom:** `document.scrollWidth` 572 px at a 375 px viewport; the card header measured 559 px.
- **Diagnosis:** a `<select>` is intrinsically as wide as its longest `<option>` ("Citizen Grievance Redressal (raw, contains PII)"), and the card header's action slot was `shrink-0`.
- **Fix:** card header is now `flex-wrap` with a `min-w-0 max-w-full` action slot (`client/src/components/ui.tsx`), plus `.input { max-width: 100% }` and `select.input { text-overflow: ellipsis }` in `styles.css`.
- **Evidence:** Anomalies, Audit and Datasets all report `docScroll 375 / win 375` at 375 px.

### D4 — Raw unformatted money reached the screen from server-generated prose (formatting, severity: medium)

- **Symptom:** the Audit page rendered the recorded simulator payload verbatim: `With 15% of ₹128566.86 cr idle capital reallocated …`. The same raw string existed in the simulator headline, output interpretations and brief bullets.
- **Diagnosis:** the server composes prose with plain template interpolation, so `₹128566.86 cr` is embedded in strings the UI cannot format field-by-field.
- **Fix:** added `prettifyMoney()` to `client/src/lib/format.ts` — an idempotent rewriter that re-emits every `₹…`/`₹… cr` token found in a string through the single `fmtCr`/`fmtRupees` helpers. Applied to the simulator headline and interpretations, brief KPIs, bullets and evidence notes, ask answers, and every string, chip and cell rendered by `DetailView` (which is what the audit payload viewer uses).
- **Evidence:** the audit payload now reads `₹1.29L cr`; assertion 7 is clean on all 190 shots.

### D5 — 7-digit unformatted number in the dataset column profile (formatting, severity: medium)

- **Symptom:** `datasets/1` showed `μ 2,66,746.10 · 2044 … 2159424` for `beneficiaries`.
- **Diagnosis:** min/max come back from SQLite as numeric **strings**, so `fmtCell` fell through to `String(v)`; the mean also bypassed compact formatting.
- **Fix:** `fmtCell` now coerces numeric strings and routes anything ≥ 10,000 through `fmtCompact`.
- **Evidence:** the same row now reads `μ 2.67L · 2,044 … 21.6L`, and money columns read `μ ₹788.1 cr · ₹42.51 cr … ₹3.1K cr`.

### D6 — Forecast always opened on a NOT_APPLICABLE state (UX, severity: medium)

- **Symptom:** the default active dataset is `scheme_expenditure`, whose only time column is `fy` with 7 distinct periods, so AI-3 correctly returns 422 NOT_APPLICABLE — meaning the Forecast page never showed a chart on a cold open.
- **Diagnosis:** correct backend behaviour, poor first-run UX; the old hint told the user to "use the switcher" and listed datasets that are equally un-forecastable (`bridge_health`, `citizen_grievances` are cross-sectional).
- **Fix:** added a `forecastable` selector to the dataset context (time column is a repeating reporting period) and turned the NOT_APPLICABLE hint into one-click switch buttons for exactly those datasets.
- **Evidence:** 6 switch buttons offered; `[data-testid="chart-forecast"]` present after one click (interaction check `forecast:not-applicable-recovery` PASS). The explicit 422 explanation is still rendered — never a blank chart.

### D7 — Ask page opened with no answer (UX, severity: medium)

- **Symptom:** `/ask` mounted with an empty answer area, breaking the "no page is ever empty" rule.
- **Fix:** a ref-guarded effect runs the engine's **own** first example question exactly once on mount (nothing hard-coded), so the page opens with a worked answer, chart, table and interpretation panel.
- **Evidence:** cold open now renders `Ranking schemes by sum(spent cr) … Computed over 12 groups and 1008 ingested rows` plus the formula.

### D8 — Inner table sub-labels overflowed instead of truncating (layout, severity: low)

- **Symptom:** `span` 424 px inside a 272 px cell on Anomalies (light, 1280); the same pattern on Brief, Ingest, Lineage, Audit.
- **Diagnosis:** the parent had `truncate` but the nested `block` child did not inherit it.
- **Fix:** `truncate` added to those nested spans; full value retained in the `title` attribute.

### D9 — Long formula strings pushed card headers past their box (layout, severity: low)

- **Symptom:** `SHA-256(prevHash|seq|ts|actor|action|entity|payloadHash)` measured 315 px in a 291 px hint (Brief, Dashboard).
- **Fix:** card hint paragraph is now `break-words`.

### D10 — Role select in the user table was crushed to 28 px (layout, severity: low)

- **Fix:** the role `<select>` in `Users.tsx` has a fixed `w-[7.5rem]`, so all four role options stay legible.

### D11 — Not-found page was thinner than the empty-state threshold (content, severity: low)

- **Symptom:** 202 characters of main content, below the 240-character "unexplained empty state" bar.
- **Fix:** the 404 state now explains hash routing, confirms the session and data are intact, and links back to the dashboard.

### D12 — TypeScript strictness violations caught before the first build (5 errors)

`Anomalies.tsx` passed `string | null` into `clip(text: string)` (2×); unused imports in `Ask.tsx`, `Dashboard.tsx`, `Simulate.tsx`; `Simulate.tsx` built chart rows as `Record<string, number | string>` instead of `SeriesPoint`. All fixed; `npx tsc --noEmit` (root) and `npx tsc --noEmit -p client/tsconfig.json` are both clean.

### Harness bugs fixed while testing (recorded for honesty, not app defects)

- The multi-suffix money assertion flagged the *correct* `₹1.29L cr` because its alternation `(K|L|Cr)` matched the unit "cr" case-insensitively; tightened so only genuine doubles (`₹2.8Cr cr`, `₹250 cr cr`, `₹1.2L K`) fail.
- The overflow assertion flagged tables that legitimately scroll inside their own container, and SVG chart labels; both are now excluded.
- The theme toggle and role badge are intentionally hidden at 375 px, so the harness drives the toggle through the DOM and waits on `[data-testid="topbar"]`.

---

## 4. Build and delivery

```
npm run build      # tsc -p tsconfig.json  +  node scripts/build-client.mjs (vite build)
```

| Artefact | Size |
| --- | --- |
| `client/dist/index.html` | 1.01 kB |
| **Entry chunk `assets/index-*.js`** | **194,380 bytes (194.38 kB, 63.71 kB gzip) — 43 % of the 450 kB budget** |
| `assets/charts-*.js` (Recharts, lazy) | 407.84 kB (106.24 kB gzip) — loaded only by chart routes |
| `assets/index-*.css` | 27.65 kB (6.07 kB gzip) |
| Per-route lazy chunks | 0.93 kB (NotFound) – 9.93 kB (Ingest) |

Express serves `client/dist` with an SPA catch-all that excludes `/api/*`, so `http://localhost:5000/` returns the app and `/anything` returns `200` with `index.html`. One deployable unit, one port.

Verified after the final build: `GET /` → 200, `GET /api/health` → 200, `GET /foo` → 200 (SPA fallback).

## 5. Compliance with the SPEC §8 UX rules

| Rule | Status |
| --- | --- |
| 20 routes | all present, all screenshotted |
| GovTech deep-navy/teal + saffron palette, dark and light | dark `bg 6 16 26 / surface 12 27 42 / teal 45 212 191 / saffron 255 153 51`; light `bg 240 244 249 / teal 13 124 122 / saffron 200 106 8`; both themes shot for every route |
| One money helper | `fmtCr` is the only emitter of `₹` and `cr`; `prettifyMoney` funnels server prose through it; assertion 7 clean on 190 shots |
| Auto-run exactly once per page | `useAutoRun(runner, key, enabled)` is ref-guarded per key; `main.tsx` deliberately omits `StrictMode` so no page double-fires |
| Skeleton loaders | `SkeletonCards / SkeletonChart / SkeletonTable / SkeletonText` on every data page |
| Explicit error / denied / not-applicable states | `ErrorState`, `DeniedState`, `NotApplicableState` (renders the 422 explanation plus recovery buttons — never a blank chart) |
| JWT in React state only | token lives in `useState` inside `auth.tsx`; no `localStorage`, `sessionStorage` or cookie writes anywhere in `client/src` |
| `data-testid` coverage | every page root, KPI, card, table, chart, filter, lever and action button |
| Route-level `React.lazy`, entry < 450 kB | 19 lazy routes; entry 194.38 kB |
| Responsive at 1280 and 375 | 0 overflow violations at both widths after D2/D3 |
| Offline | bundled Noto Sans for the ₹ glyph, inline SVG logo/favicon, no external network requests |

## 6. Known issues and honest limitations

1. **`/login` is not in the 19-route screenshot matrix** — an authenticated session redirects away from it. It is covered by the four `flow-login-*.png` interaction shots instead.
2. **Recharts is a 408 kB lazy chunk.** It never blocks first paint (the entry chunk is 194 kB) but the first chart route pays ~106 kB gzip. Replacing Recharts with hand-rolled SVG would remove it; not attempted.
3. **Mobile screenshots are director-only.** minister/analyst/auditor were captured at 1280 in both themes (per the brief). The shell is identical across roles at 375 apart from the permission-filtered sidebar.
4. **The live tick mutates state, so counts in this report are point-in-time.** Anomalies stood at 146 and rows at 6,485 when the report was written; running the tick again will change both. The QA dataset `qa_flow_air` created by the ingest flow was deleted afterwards, leaving the 8 seeded datasets.
5. **Simulator outputs remain modelled, not measured.** Two of the nine outputs (bed shortfall in particular) sit at 0 for the seeded data, which is a property of the seeded baseline rather than a UI fault; the page labels every output with its formula, interpretation and a caveat.
6. **Clipping detection is heuristic.** It catches `overflow: hidden` leaves whose content is taller than their box; a glyph clipped by exactly one or two pixels inside an ellipsised element would not be flagged. Manual review of the 190 PNGs found none.
