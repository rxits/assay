# 01 — Product Requirements (assay)

> Purpose: define *what must be true* for `assay` to succeed and *why*, before any
> "how." Derived from 00-SPEC.md — all entity names, fields, enums, routes, and
> formulas below are quoted from that canonical source; where they differ, 00-SPEC wins.

---

## 1. Problem statement

Organizations accumulate datasets far faster than they can govern them: CSVs
exported from a dozen tools, spreadsheets emailed around, dumps from legacy
systems. The pile grows opaque. Nobody can answer the three questions governance
actually cares about:

- **What's in it, and how sensitive is it?** Unflagged PII (emails, national IDs,
  card numbers) sitting in a random spreadsheet is a compliance incident waiting to happen.
- **How much can I trust it?** A file half full of blanks, duplicate rows, and
  mixed-type columns will quietly poison any decision made on it.
- **Is it even worth keeping?** Most stored data is never read again. Hoarding it
  costs storage, attention, and audit surface.

Today a steward answers these by *manually opening each file and eyeballing it* —
slow, inconsistent, and unauditable. A governance catalog replaces that with a
browsable, scored inventory: upload a raw dataset and immediately see its
structure, its sensitive fields, and explainable quality / trust / value scores.

**Hypothesis (the bet).** We believe an automated *ingest-and-score* catalog will
let a data steward triage an unfamiliar dataset in seconds instead of minutes of
manual inspection. We'll know we're right when uploading each committed sample
(§11) yields correct, self-explaining scores and the four Data-Value profiles
(hot / declining / stale / dead) render as visibly distinct rows in the dashboard.

**Why this, why now.** This is the Proteccio "Data Governance Dashboard" take-home.
The exercise deliberately tests *judgment on messy data* — inferring structure,
flagging sensitivity, and separating three orthogonal ideas of worth
(quality vs. trust vs. value) — not CRUD boilerplate.

## 2. Target user & primary use case

**Primary user — the data steward.** A person responsible for cataloging,
classifying, and lifecycle-managing an organization's datasets. They are handed
(or discover) files of unknown provenance and must decide how sensitive, how
reliable, and how valuable each one is.

**Primary use case (the happy path).** The steward uploads a new CSV/XLSX. Within
a single screen they see: inferred column types, auto-flagged PII, a Quality
score, a Trust score, a Value score, and a Keep / Optimize / Archive / Retire
recommendation — each score expandable into *why* it got that number. They then
browse the whole catalog, sorted/filtered, to triage which datasets need
attention. Secondary flow: correcting a misclassification via manual override,
which recomputes trust.

**Not for** (explicit exclusions, reinforced in §3):
- Not a multi-steward org tool — no accounts, tenants, or RBAC.
- Not a data engineer's pipeline / ETL tool — `assay` *diagnoses* data, it does not clean or transform it.
- Not a real-time / streaming system — datasets are uploaded files, profiled once (re-profile on demand).

## 3. Goals & non-goals

**Goals**
1. Ingest CSV/XLSX and produce a complete, browsable profile covering all 7 brief
   areas (§3 of 00-SPEC): Ingestion, Discovery, Classification, Quality, Trust, Value, Dashboard.
2. Give every dataset an **explainable** `qualityScore`, `trustScore`, and
   `valueScore` plus a `valueRecommendation`, with the component sub-scores exposed
   via `scoreBreakdown` ("explain this score").
3. Auto-classify sensitive columns, and make **manual override** first-class
   (the steward is always in control).
4. Ship a polished dashboard: catalog list → column-level detail, with score
   transparency and visualization.
5. **Degrade gracefully everywhere** — messy and edge-case files (empty, duplicate
   headers, ragged rows, large) must never make the live demo look broken; the AI
   layer is optional and silent on failure.
6. Keep the core **tight, well-structured, and tested**, and deployable on day one.

**North-star / 10-star version (deliberately NOT built).** Cross-dataset lineage,
scheduled auto re-profiling, org-wide RBAC, live usage telemetry pulled from real
BI tools, and automated remediation suggestions. Naming these keeps them out of
scope on purpose — extra scope earns zero rubric points (00-SPEC §2.1).

**Non-goals (mirror 00-SPEC §12 — do NOT build)**
- No authentication, no multi-user / RBAC.
- No realtime / websockets.
- No job queue — the ingest pipeline runs **inline**; large files are capped/streamed instead.
- No production infra / observability stack.
- (Reinforcing) No data remediation/cleaning, no cross-dataset lineage, and **no persistence of raw rows** (aggregates + capped previews only).

## 4. Functional requirements (user stories + acceptance criteria)

One story per brief area. Acceptance criteria state *what must be true*; they cite
the canonical contract (00-SPEC §6–§10) as the source of truth, not an implementation.

### FR-1 — Data Ingestion
> As a data steward, I want to upload a CSV or XLSX file and have `assay` ingest it,
> so I can catalog a dataset without writing any code.

**Acceptance criteria**
- `POST /datasets` accepts a single multipart `.csv` or `.xlsx`; other types are
  rejected with the standard error shape `{ error: { code, message, details? } }`.
- On accept, a `Dataset` is created with `name` (defaulting to `originalFilename`),
  `originalFilename`, `fileType` (`CSV` | `XLSX`), `sizeBytes`, and `status = PROCESSING`.
- The pipeline runs **inline** (no queue) and on success sets `rowCount`,
  `columnCount`, scores, and `status = READY`; on unrecoverable error it sets
  `status = FAILED` with a human-readable `errorMessage`.
- Input is **stream-parsed**; a capped `sampleRows` preview (≤50 rows) is stored and
  **raw rows are not persisted** (00-SPEC §6 storage decision).
- The response returns the dataset summary (id, status, counts, and scores when `READY`).

### FR-2 — Data Discovery
> As a data steward, I want each column's type and profile inferred automatically,
> so I understand a dataset's shape without opening the file.

**Acceptance criteria**
- Each `Column` persists `name` (original header), `position` (0-based), and
  `dataType` ∈ {`STRING`,`INTEGER`,`FLOAT`,`BOOLEAN`,`DATE`,`DATETIME`,`UNKNOWN`}.
- Each column persists a profile: `missingCount`, `missingPct` (0–1),
  `distinctCount`, `completeness` (0–1), `validity` (0–1), and `sampleValues` (≤10).
- Type is inferred from value sampling; an ambiguous or empty column resolves to
  `UNKNOWN` rather than throwing.
- Columns are retrievable via `GET /datasets/:id`.

### FR-3 — Data Classification
> As a data steward, I want sensitive columns auto-flagged and to be able to override
> any tag, so the catalog reflects reality and I stay in control.

**Acceptance criteria**
- A classified `Column` gets exactly one `ClassificationTag`: `category` ∈ `PiiCategory`
  (§8), `sensitivity` ∈ {`NONE`,`LOW`,`MEDIUM`,`HIGH`} defaulting per the §8 map,
  `source` ∈ {`AUTO_REGEX`,`AUTO_AI`,`MANUAL`}, and `confidence` (0–1).
- Auto-classification uses two signals: (a) header-name regex and (b) value-pattern
  sampling; a category is assigned when its match share ≥ `CLASSIFY_THRESHOLD = 0.70`,
  with `confidence = match share`.
- A column with a resolved tag — **including an explicit `NONE`** — counts as
  "classified" for coverage.
- `PATCH /datasets/:id/columns/:columnId/classification` applies a `MANUAL` override,
  sets `overridden = true`, and recomputes `ClassificationCoverage` and Trust (FR-5).
- **AI refine is optional and graceful:** invoked only for *ambiguous* columns
  (no category ≥ threshold, or header/value conflict) **and only if `GROQ_API_KEY`
  is set**; results are cached in the DB; a missing key or any error falls back
  silently to the regex best-guess (see NFR-1).

### FR-4 — Data Quality
> As a data steward, I want a per-dataset quality score backed by explicit checks,
> so I can triage which datasets need cleanup.

**Acceptance criteria**
- `QualityCheck` rows record `checkType` ∈ {`MISSING_VALUES`,`DUPLICATE_ROWS`,
  `INVALID_VALUES`,`TYPE_MISMATCH`,`EMPTY_COLUMN`,`DUPLICATE_HEADER`}, `severity` ∈
  {`INFO`,`WARNING`,`ERROR`}, `affectedCount`, `affectedPct` (0–1), and `detail`;
  a null `columnId` denotes a dataset-level check (e.g. duplicate rows).
- `qualityScore = 100 × (0.40·Completeness + 0.30·Validity + 0.30·Uniqueness)`, where
  `Completeness = mean(completeness_col)`, `Validity = mean(validity_col)`, and
  `Uniqueness = 1 − duplicateRows / rowCount`.
- `scoreBreakdown` persists the component sub-scores for "explain this score."
- The messy sample (`messy_orders.csv`) yields a visibly lower `qualityScore` than
  the clean sample (`customers.csv`).

### FR-5 — Data Trust
> As a data steward, I want a trust score that reflects both quality and how completely
> a dataset is classified, so I know how much to rely on it.

**Acceptance criteria**
- `trustScore = 100 × (0.45·(Quality/100) + 0.30·Consistency + 0.25·ClassificationCoverage)`.
- `Consistency = mean(dominantTypeShare_col)`, penalized by structural issues
  (duplicate/blank headers, ragged rows).
- `ClassificationCoverage = classifiedColumns / columnCount`.
- Trust **recomputes** after a manual classification override (FR-3), so the score
  visibly responds to steward action.
- `scoreBreakdown` exposes the three Trust inputs.
- **Design invariant:** Trust ⊇ Quality (Trust is derived *from* Quality + classification);
  Value is independent (FR-6). This distinction must be preserved.

### FR-6 — Data Value
> As a data steward, I want a usage-based value score and a lifecycle recommendation,
> so I can decide what to keep, optimize, archive, or retire.

**Acceptance criteria**
- `valueScore = 100 × (0.45·Frequency + 0.35·Recency + 0.20·Trend)` where
  `Frequency = min(1, log1p(accesses_90d) / log1p(FREQ_CAP))` with `FREQ_CAP = 50`,
  `Recency = exp(−daysSinceLastAccess / HALFLIFE)` with `HALFLIFE = 30`, and
  `Trend = clamp01(0.5 + (accesses_last30 − accesses_prev30) / (2·max(1, accesses_prev30)))`.
- Value is computed **only** from `AccessEvent`s (`type` ∈ {`VIEW`,`DETAIL_VIEW`,`DOWNLOAD`},
  `source` ∈ {`SEED`,`LIVE`}); it is **independent of quality/trust**.
- `valueRecommendation` is derived per the §9 table: `RETIRE` (0 accesses in 90d **or**
  Value < 15), `ARCHIVE` (Value 15–35 **and** declining trend), `OPTIMIZE` (Value 35–60),
  `KEEP` (Value ≥ 60).
- `GET /datasets/:id` records a `DETAIL_VIEW` (`source = LIVE`), and Value recomputes on read.
- `GET /datasets/:id/usage` returns a daily access time-series for the value chart.
- Seed data (§10) produces at least the four profiles — **hot, declining, stale, dead** —
  so the demo shows a full spread including a `RETIRE` candidate.

### FR-7 — Dashboard
> As a data steward, I want a browsable catalog that drills into column-level detail,
> so I can find and inspect datasets quickly.

**Acceptance criteria**
- The catalog view lists datasets from `GET /datasets` showing row/column counts,
  sensitivity tags, quality/trust/value scores, recommendation, and usage; it supports
  sort and filter via `?sort=`, `?sensitivity=`, and `?recommendation=`.
- Clicking a dataset opens detail from `GET /datasets/:id`: columns, tags, checks,
  score breakdowns, `healthNarrative` (when present), and the usage series.
- Every score is **explainable in-UI** via its `scoreBreakdown`.
- Scores render as gauges/visualizations and the usage series as a trend chart.
- A `FAILED` dataset surfaces its `errorMessage` rather than a broken detail view.

## 5. Non-functional requirements

### NFR-1 — Graceful degradation (esp. the AI layer)
- The AI layer is **strictly optional**. No `GROQ_API_KEY`, an API error, or a
  timeout must never break ingestion or the demo — fall back silently to the regex
  best-guess. `healthNarrative` is nullable and its absence must render cleanly.
- AI results are **cached in the DB and never re-charged on read** — `GET` endpoints
  must not call the model.
- A failure profiling or classifying a *single column* degrades that column to
  `UNKNOWN` / best-guess; it must not fail the whole dataset.

### NFR-2 — Edge-case handling (the 15% "data handling" bucket)
The committed samples (`broken.csv`, `messy_orders.csv`, `employees.xlsx`) exist to
force these; each must be handled, not crashed:
- **Empty file** → `status = FAILED` with a clear `errorMessage`; no crash.
- **Duplicate headers** → `DUPLICATE_HEADER` check; columns disambiguated by
  `position`; `Consistency` penalized.
- **Ragged rows** (varying column counts) → parsed without throwing; flagged; `Consistency` penalized.
- **Blank/empty column** → `EMPTY_COLUMN` check; `dataType = UNKNOWN`; `completeness = 0`.
- **Mixed types in a column** → dominant type inferred; off-type values counted as
  invalid (`validity < 1`) and surfaced as `TYPE_MISMATCH` / `INVALID_VALUES`.
- **Large file** → stream-parsed, size-capped, raw rows never persisted (NFR-3).

### NFR-3 — Performance caps
- **Stream-parse** both CSV (PapaParse) and XLSX (SheetJS); compute per-column
  aggregates incrementally.
- Enforce a configurable **file-size cap**; oversized uploads are rejected with a
  clear error *before* parsing exhausts memory.
- Persist only per-column aggregates, a ≤50-row `sampleRows` preview, and ≤10
  `sampleValues` per column — never the raw rows.
- The pipeline is inline (no queue); this is safe *because* large files are capped/streamed.

### NFR-4 — Transparency
- Every score exposes its component inputs via `scoreBreakdown` and is explainable in-UI.
- All weights/thresholds (`CLASSIFY_THRESHOLD`, `FREQ_CAP`, `HALFLIFE`, and the score
  weights) live in **one config object** and are surfaced in the explanation.
- Classification shows its `source` (`AUTO_REGEX` / `AUTO_AI` / `MANUAL`) and
  `confidence`; manual overrides are visibly marked (`overridden = true`).

## 6. Success criteria (mapped to the assignment rubric — 00-SPEC §14)

| Criterion | Weight | How this PRD ensures it |
|---|---|---|
| Code structure & readability | 15% | Requirements are framed against pure, testable logic (scoring/classification) separate from HTTP/orchestration; shared types across API and web (design mandate carried from 00-SPEC §5). |
| Functional correctness | 20% | FR-1…FR-7 cover all 7 brief areas; scoring & classification formulas are pinned (§9) and unit-testable; sample datasets provide known-good expected outcomes. |
| Data handling & edge cases | 15% | NFR-2 enumerates every messy case; committed samples (`broken.csv`, `messy_orders.csv`) profile without breaking. |
| Frontend UX | 15% | FR-7 requires catalog→detail navigation, filter/sort, score gauges/visualization, and in-UI score explanation. |
| Live deployment | 10% | `GET /health` for deploy checks; deployable day one; serverless cold-start acknowledged (open question OQ-6). |
| Git hygiene | 10% | Conventional Commits, incremental (00-SPEC §13) — a process criterion carried into the build plan. |
| Documentation (README) | 15% | This PRD and its siblings feed the README's design-decisions section; every non-brief dependency is justified there (00-SPEC §4). |

**Demo-level "done" (the fast read on whether the bet paid off):** all five samples
upload and reach a terminal state (`READY` or a clean `FAILED`); `customers.csv`
scores high and `messy_orders.csv` scores visibly lower; PII columns are auto-flagged;
a manual override moves the Trust score; and the four Value profiles render distinctly,
one of them a `RETIRE` candidate.

## 7. Assumptions & open questions

**Assumptions**
- **A1** — Problem evidence is the assignment brief plus well-established
  data-governance domain pain, *not* primary user research. Treat the problem as
  validated-for-this-exercise; a real product would validate via steward interviews.
- **A2** — Single trusted steward; no auth/tenancy needed (00-SPEC §12).
- **A3** — Usage/Value is driven by **seeded, backdated `AccessEvent`s** plus live
  `DETAIL_VIEW`s — no real telemetry source exists yet (00-SPEC §10).
- **A4** — "Declining trend" (for the `ARCHIVE` rule) is read as `Trend < 0.5`,
  i.e. `accesses_last30 < accesses_prev30`, consistent with the §9 `Trend` formula.
- **A5** — `POST /datasets/:id/reprofile` and `DELETE /datasets/:id` are marked
  optional in 00-SPEC §7 — treated as **stretch**, out of the MVP demo path.

**Open questions**
- [ ] **OQ-1** — Exact file-size / row cap value. Propose a conservative default
  (e.g. ~10 MB or ~100k rows) tuned to the Neon free tier and inline processing;
  confirm during the build. *TBD — needs validation via a load spot-check.*
- [ ] **OQ-2** — XLSX multi-sheet handling: assume **first sheet only** for MVP;
  confirm against `employees.xlsx`.
- [ ] **OQ-3** — CSV encoding/delimiter: assume UTF-8 with delimiter auto-detection
  (PapaParse); confirm no sample needs an override.
- [ ] **OQ-4** — Precise definition of an "invalid value" per `dataType` (esp. date
  parsing) that feeds `validity` — pin the rule set in the build plan so scores are reproducible.
- [ ] **OQ-5** — Whether `healthNarrative` should have a non-AI fallback string (e.g.
  a templated summary) so the detail view never shows an empty narrative, or simply
  hide the section when null. *Leaning: hide when null (simplest graceful path).*
- [ ] **OQ-6** — Serverless (Neon) cold-start on the deployed demo: acknowledge in the
  README (00-SPEC §14) and consider a lightweight keep-warm ping; confirm acceptable
  latency for reviewers.

---
*Status: DRAFT — requirements only. Implementation decomposition lives in 10-BUILD-PLAN.md; all contracts derive from 00-SPEC.md.*
