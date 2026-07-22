# assay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan is the sequencer for the package `docs/00`–`docs/09`.** Canonical code is defined once in those docs and referenced here by section (e.g. "schema per `03 §3`"), not re-pasted — that is deliberate DRY, not a placeholder. A worker reads the task **and** its cited section together.

**Goal:** Build `assay` — a Data Governance Dashboard that ingests CSV/XLSX, discovers structure, classifies sensitive columns, and scores each dataset's Quality, Trust, and Value on a polished, browsable dashboard — deployed live.

**Architecture:** pnpm-workspace monorepo. `apps/api` (Express + Prisma + Postgres) runs the inline ingestion pipeline `routes → services → domain`, where a pure, unit-tested `domain/` layer holds all scoring/classification judgment. `apps/web` (React + Vite + shadcn/ui + Recharts) renders the catalog and per-column detail. `packages/shared` holds the wire-contract DTOs both import. See `02` for the full architecture and ADRs.

**Tech Stack:** Node 22 · pnpm 11 · TypeScript 5 (strict) · Express 4 · Prisma 5 · PostgreSQL 16 (Neon) · multer · PapaParse · SheetJS · `@anthropic-ai/sdk` (optional) · React 18 · Vite 5 · Tailwind 3 · shadcn/ui · TanStack Query 5 · Recharts 2 · Vitest · Supertest · RTL.

## Global Constraints

- **Node** ≥ 22.x; **pnpm** 11.6.0 pinned via root `packageManager` (`corepack enable`). *(00 §4)*
- **TypeScript `strict`** everywhere; `camelCase` values, `PascalCase` types/components, `kebab-case` files (React components `PascalCase.tsx`); enums `UPPER_SNAKE`; REST plural nouns; timestamps ISO-8601. *(00 §13)*
- **Conventional Commits**, incremental — never one giant commit (git hygiene = 10%). *(00 §13)*
- **No** auth, multi-user, realtime, job queue, or prod-infra stack. Ingest runs inline; large files are stream-parsed and capped. *(00 §12)*
- **Raw rows are never persisted** — only per-column aggregates, scores, and a ≤50-row `sampleRows` preview. *(00 §6, 03 §6)*
- **Graceful degradation is mandatory** — no input (bad file, missing AI key, cold DB) may make the live demo look broken. *(00 §2.3)*
- **Secrets** (`GROQ_API_KEY`, `DATABASE_URL`) live only in host env / gitignored `.env`; repo ships `.env.example` with empty placeholders. The AI key is server-side only. *(00 §8, 09 §5)*
- **Canonical scoring** weights/constants and **canonical enums/routes** come from `00 §6–§9`. Do not alter formulas; only elaborate under-specified constants (already pinned in `06 §3`, `07 §0`).

---

## 0. Cross-doc reconciliation decisions (resolve BEFORE coding)

Nine docs were written in parallel; these are the only seams where two docs chose differently. **This section is canonical — it overrides the individual docs where they conflict.**

| # | Seam | Docs | **Decision (canonical)** |
|---|---|---|---|
| R1 | Empty-dataset return: pure fn returns `0` vs `null` | `06` (0) vs `08` (null) | **Pure `domain` fns are total — return a defined `0` (`06`).** The **service** maps an empty/unparseable dataset to `status=FAILED` + null score *columns*. Update `08`'s `scoreQuality(empty) === null` examples to assert `computeQuality(empty).score === 0` (pure) and a separate service test for the null-column outcome. |
| R2 | Scoring fn names `compute*` vs `score*` | `06` vs `08` | **`computeQuality` / `computeTrust` / `computeValue` / `recommend`** (`06 §9`). Rename `08`'s `score*` calls. |
| R3 | Structural penalty as multiplier field vs derived | `08` (`structuralPenalty:0.8`) vs `06` (from `structuralIssues[]`, 0.05/issue cap 0.20) | **Derive from `structuralIssues[]` per `06 §5`.** `profile.structuralIssues: StructuralIssueType[]` is the input; the multiplier is computed. |
| R4 | Bad-file-type response | `08` (400 / `UNSUPPORTED_FILE_TYPE`) vs `04` (415 / `unsupported_file_type`) | **415 + lowercase `unsupported_file_type`** (`04 §1.5` registry is the API authority). Fix `08`'s integration assertion. |
| R5 | Canonical scoring fixtures | `06` (`customers`, 3 dup → Q 97.06) vs `08` (10 dup → Q 95.0) | **Use `06`'s worked numbers as the fixture of record**; align `08`'s scoring test fixture to `06 §4/§5` so both assert the same arithmetic. (Either is correct for its own inputs; we pick one.) |
| R6 | `healthNarrative === null` UI | `PRD OQ-5` (hide) vs `05 §5.4` (neutral placeholder) | **Neutral placeholder** "Narrative unavailable — scores are computed deterministically." (`05` is UX authority; nicer than a missing block.) |
| R7 | XLSX multi-sheet (`PRD OQ-2`) | open | **First sheet only** for MVP; note in README assumptions. |
| R8 | Anthropic structured-output SDK shape | `07 §6.2` uses `output_config.format` (json_schema) | **Verify against the installed `@anthropic-ai/sdk` at build (Task 2.5).** The adapter MUST defensively parse: try the structured field, else `JSON.parse` the text block, else fall back to regex. Never let SDK-shape drift break ingestion. |
| R9 | "Invalid value" per `dataType` (`PRD OQ-4`) that feeds `validity` | open | Pin in profiling (Task 1.2): `INTEGER` `/^-?\d+$/`; `FLOAT` finite `Number()`; `BOOLEAN` ∈ {true,false,0,1,yes,no} (ci); `DATE`/`DATETIME` valid `Date.parse`; `STRING`/`UNKNOWN` always valid. |
| R10 | Brand-new (non-seeded) dataset shows Value→`RETIRE` until first view | `06 §8` | **Correct by design — keep.** UI renders the low-usage/empty state ("No access events yet", `05 §5.4`); seeds carry history so the demo spread is immediate. Do **not** add a grace period (would diverge from `00 §9`). |

---

## 1. File & responsibility map

Synthesized from `02 §2` / `00 §5`. One responsibility per file; files that change together live together.

```
assay/
├─ package.json                      # workspace root; packageManager pnpm@11.6.0; scripts (test, typecheck, dev)
├─ pnpm-workspace.yaml               # apps/*, packages/*
├─ tsconfig.base.json                # strict base extended by every package
├─ .github/workflows/ci.yml          # install → typecheck → test (Postgres service) — 09 §8
├─ .gitignore / .env.example(s)      # secrets hygiene — 09 §5
├─ README.md                         # setup, assumptions, design decisions (fed by 00–09), cold-start note — 09 §7
├─ samples/                          # customers.csv, messy_orders.csv, employees.xlsx, events_log.csv, broken.csv — 00 §11
├─ packages/shared/
│   └─ src/index.ts                  # enums + DTOs (string-literal unions) — 04 §4  (the wire contract)
├─ apps/api/
│   ├─ prisma/schema.prisma          # 6 models, 11 enums — 03 §3 (paste verbatim)
│   ├─ prisma/seed.ts                # runs samples through the REAL pipeline + backdated AccessEvents — 03 §7, 00 §10
│   ├─ src/lib/
│   │   ├─ config.ts                 # ALL weights + constants (scoring 06 §3, classify 07 §0, MAX_UPLOAD_BYTES=10MiB)
│   │   ├─ prisma.ts                 # Prisma client singleton
│   │   ├─ parsers.ts                # CSV (PapaParse) + XLSX (SheetJS, first sheet) → header + row stream
│   │   └─ anthropic.ts              # optional client (null when no key); classifyColumnAI + narrative — 07 §6
│   ├─ src/domain/                   # PURE, unit-tested — no I/O
│   │   ├─ profile.ts                # inferColumnType + per-column profiling — 08 §3.3, R9
│   │   ├─ classification.ts         # header+value regex, resolveTag — 07 §3–§5
│   │   ├─ quality.ts                # detectQualityChecks — 08 §3.4
│   │   └─ scoring.ts                # computeQuality/Trust/Value/recommend — 06 §9
│   ├─ src/services/
│   │   ├─ ingest.ts                 # orchestrates parse→profile→classify→quality→score→persist
│   │   └─ catalog.ts                # list/detail/usage/override queries + Value-recompute-on-read
│   ├─ src/routes/
│   │   ├─ health.ts                 # GET /api/health (DB-free) — 09 §8
│   │   └─ datasets.ts               # the 9 routes — 04 §2 (thin handlers + zod validation + error envelope)
│   ├─ src/app.ts                    # createApp() factory (no listen) — CORS, json, multer, error handler
│   └─ src/index.ts                  # listen(process.env.PORT)
└─ apps/web/
    ├─ src/lib/api.ts                 # typed fetch client (imports @assay/shared DTOs) + TanStack Query hooks
    ├─ src/components/ui/*            # shadcn primitives + tokens — 05 §2
    ├─ src/components/catalog/*       # CatalogTable, DatasetCard — 05 §4.1–4.2
    ├─ src/components/dataset/*       # ScoreGauge, ScoreBreakdown, SensitivityBadge, ColumnPanel — 05 §4.3–4.6
    ├─ src/components/charts/*        # missing-value bar, type-dist, histogram, usage sparkline — 05 §4.7
    ├─ src/pages/CatalogPage.tsx      # 05 §6a
    └─ src/pages/DatasetDetailPage.tsx# 05 §6b
```

---

## 2. Phase roadmap (5 focused days → commit clusters)

Each phase is a cluster of conventional commits. **Deploy on Day 1** (de-risks the 10% bucket). Every domain task is TDD (`08` provides the tests).

| Day | Phase | Deliverable | Proves |
|---|---|---|---|
| 1 | **P0 Scaffold + deploy hello-world** | Monorepo, shared types, Prisma+Neon, `GET /health`, empty React app — all three services live | Deploy pipeline (10%) |
| 2 | **P1 Ingestion + Discovery** | Upload → parse → profile → persist; catalog list/detail; sample datasets | Areas 1–2, storage decision |
| 3 | **P2 Classification + Quality + Scoring** | `domain/` pure functions (TDD) + AI fallback; scores persisted | Areas 3–5, the judgment core (20%) |
| 4 | **P3 Data Value + Dashboard UI** | Seed + live tracking + recommendations; polished catalog + detail + gauges + charts | Areas 6–7, UX (15%) |
| 5 | **P4 Polish + edge cases + tests + README + final deploy** | Edge-case matrix green, README, seed on prod, commit-history cleanup | Edge cases (15%), docs (15%), git (10%) |

---

## 3. Tasks

TDD rhythm per domain task: **write failing test → run (fails) → implement per cited doc → run (passes) → commit.** Tests come from `08`; code from the cited section. Non-domain tasks (scaffold, UI, deploy) fold their setup in and end with a runnable check + commit.

### Phase 0 — Scaffold + deploy (Day 1)

**Task 0.1 — Workspace skeleton**
- Files: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example` (per `09 §5`).
- [ ] `git init`; create the workspace files; set `"packageManager":"pnpm@11.6.0"`.
- [ ] `corepack enable && pnpm install`.
- [ ] Check: `pnpm -v` = 11.6.0; workspace resolves.
- [ ] Commit: `chore: initialize pnpm monorepo workspace`.

**Task 0.2 — Shared types package**
- Files: `packages/shared/src/index.ts` (**paste `04 §4` verbatim**), its `package.json` (name `@assay/shared`) + `tsconfig.json`.
- [ ] Add the DTOs/enums; `pnpm --filter @assay/shared build`.
- [ ] Check: `tsc --noEmit` passes; `@assay/shared` importable.
- [ ] Commit: `feat(shared): add wire-contract DTOs and enums`.

**Task 0.3 — Prisma schema + Neon**
- Files: `apps/api/prisma/schema.prisma` (**paste `03 §3` verbatim**), `apps/api/.env` (gitignored, `DATABASE_URL` = Neon pooled).
- [ ] Provision Neon (`09 §3a`); `pnpm --filter @assay/api exec prisma migrate dev --name init`.
- [ ] Check: migration applies; `prisma generate` emits the client.
- [ ] Commit: `feat(api): add Prisma schema and initial migration`.

**Task 0.4 — Express app + health route**
- Files: `apps/api/src/app.ts` (`createApp()`: cors(`CORS_ORIGIN`), json, error envelope `04 §1.3`), `src/routes/health.ts` (`04 §2.1`), `src/index.ts`.
- [ ] Write failing Supertest: `GET /api/health` → 200 `{status:"ok"}`.
- [ ] Implement; run → passes.
- [ ] Commit: `feat(api): add Express app factory and health route`.

**Task 0.5 — React app shell**
- Files: `apps/web` Vite scaffold, Tailwind + shadcn init, tokens from `05 §2`, a stub `CatalogPage` calling `GET /api/health`.
- [ ] `pnpm --filter @assay/web dev` renders; theme tokens applied.
- [ ] Commit: `feat(web): scaffold Vite React app with design tokens`.

**Task 0.6 — Deploy all three (live Day 1)**
- Files: `apps/web/vercel.json` (SPA rewrite), CI `.github/workflows/ci.yml` (`09 §8`).
- [ ] Neon (done) → Render api (`09 §3b`) → Vercel web (`09 §3c`); set env vars (`09 §4`); wire `CORS_ORIGIN`.
- [ ] Check: Vercel URL loads and shows the health status from the Render API (no CORS errors).
- [ ] Commit: `ci: add GitHub Actions + deployment config`.
- **Gate:** live URL reachable end-to-end before any feature work.

### Phase 1 — Ingestion + Discovery (Day 2)

**Task 1.1 — Config + parsers**
- Files: `src/lib/config.ts` (weights `06 §3` + classify `07 §0` + `MAX_UPLOAD_BYTES=10*1024*1024`), `src/lib/parsers.ts` (CSV PapaParse; XLSX SheetJS **first sheet only**, R7).
- [ ] Unit test: parser returns `{headers, rows}` for a CSV buffer and an XLSX buffer; ragged rows null-pad, dup headers preserved by position.
- [ ] Implement; run → passes. Commit: `feat(api): add config and CSV/XLSX parsers`.

**Task 1.2 — Type inference + profiling (`domain/profile.ts`)**
- Files: `src/domain/profile.ts`, `profile.test.ts` (**tests from `08 §3.3`**; validity rules per **R9**).
- [ ] Write failing tests (type inference table + completeness/validity/distinct/sampleValues).
- [ ] Implement `inferColumnType` + `profileColumn`; run → passes. Commit: `feat(domain): column type inference and profiling`.

**Task 1.3 — Ingestion service (persist, no scores yet)**
- Files: `src/services/ingest.ts`, `src/routes/datasets.ts` (`POST /datasets` per `04 §2.2`: multer `.single("file")`, `fileFilter` → 415, `limits.fileSize` → 413), zod validation.
- [ ] Integration test (Supertest, from `08 §9`, **fixed to R4**): upload CSV → 201 `READY`, correct `rowCount`/`columnCount`; `.pdf` → **415 `unsupported_file_type`**.
- [ ] Implement create→parse→profile→persist `Dataset`+`Column` (+`sampleRows` ≤50); leave scores null for now.
- [ ] Run → passes. Commit: `feat(api): dataset upload, parsing, and discovery`.

**Task 1.4 — Catalog list + detail (read)**
- Files: `src/services/catalog.ts`, routes `GET /datasets` (`04 §2.3`, offset pagination/sort/filter) + `GET /datasets/:id` (`04 §2.4`, nested detail; Value-recompute wired in P3).
- [ ] Integration test: list contains the upload; detail returns columns.
- [ ] Implement; run → passes. Commit: `feat(api): catalog list and dataset detail endpoints`.

**Task 1.5 — Sample datasets**
- Files: `samples/*` engineered per `00 §11` (each exercises specific edge cases from `08 §6`).
- [ ] Hand-craft 5 files (customers, messy_orders, employees.xlsx, events_log, broken).
- [ ] Check: upload each locally; messy/broken behave gracefully.
- [ ] Commit: `test: add engineered sample datasets`.

### Phase 2 — Classification + Quality + Scoring (Day 3)

**Task 2.1 — Classification regex (`domain/classification.ts`)**
- Files: `classification.ts`, `classification.test.ts` (**TP+FP tests from `08 §3.2`**; patterns/logic from `07 §3–§5`, incl. Luhn, ID_NUMBER surrogate-key guard, explicit-NONE-counts-coverage).
- [ ] Write failing tests; implement `classifyColumn`/`resolveTag`; run → passes.
- [ ] Commit: `feat(domain): regex + heuristic PII classification`.

**Task 2.2 — Quality checks (`domain/quality.ts`)**
- Files: `quality.ts`, `quality.test.ts` (**matrix from `08 §3.4`**; enums from `03`).
- [ ] Write failing tests; implement `detectQualityChecks`; run → passes.
- [ ] Commit: `feat(domain): per-column and dataset quality checks`.

**Task 2.3 — Scoring engine (`domain/scoring.ts`)**
- Files: `scoring.ts`, `scoring.test.ts` (**code from `06 §9`, tests from `06 §10`/`08 §8` reconciled per R1/R2/R3/R5**; branded `Unit`, config self-check).
- [ ] Write failing tests (Quality/Trust/Value worked examples + empty-dataset `score===0` + weight-sum self-check).
- [ ] Implement `computeQuality/computeTrust/computeValue/recommend`; run → passes.
- [ ] Commit: `feat(domain): quality, trust, and value scoring engine`.

**Task 2.4 — Wire scoring into ingestion**
- Files: `services/ingest.ts` (call classification + quality + scoring; persist `qualityScore/trustScore/valueScore/valueRecommendation/scoreBreakdown`, `ClassificationTag`, `QualityCheck`; empty/unparseable → `status=FAILED` + null columns per **R1**).
- [ ] Integration test: `customers.csv` scores high, `messy_orders.csv` visibly lower; `broken.csv` → `FAILED` at 201.
- [ ] Implement; run → passes. Commit: `feat(api): integrate scoring into ingestion pipeline`.

**Task 2.5 — Optional AI layer (graceful)**
- Files: `src/lib/llm.ts` (`07 §6.2`, **R8 defensive parse**), hook into `ingest.ts` for ambiguous columns + `healthNarrative`.
- [ ] **Verify `@anthropic-ai/sdk` structured-output shape** against installed version; adapt adapter; ensure `anthropic===null` path (no key) is the tested default.
- [ ] Test: with no key, classification still resolves via regex, `healthNarrative` null; ambiguous fixture → AUTO_AI only when key present (mock).
- [ ] Commit: `feat(api): optional Claude classification and health narrative`.

**Task 2.6 — Manual override (`PATCH …/classification`)**
- Files: route per `04 §2.5` + `catalog.ts` recompute (`07 §8`: source=MANUAL, overridden=true, recompute ClassificationCoverage→Trust).
- [ ] Test: override flips tag, Trust recomputes, Quality/Value unchanged.
- [ ] Commit: `feat(api): manual classification override with trust recompute`.

### Phase 3 — Data Value + Dashboard (Day 4)

**Task 3.1 — Value-on-read + usage endpoint**
- Files: `catalog.ts` (`GET /:id` records `DETAIL_VIEW` + recomputes Value, `?track=false` to suppress — `04 §2.4`), `GET /:id/usage` (`04 §2.6`, zero-filled daily series).
- [ ] Test: detail view appends a LIVE event and updates Value; `?track=false` doesn't.
- [ ] Commit: `feat(api): value-on-read tracking and usage time-series`.

**Task 3.2 — Seed (backdated profiles)**
- Files: `prisma/seed.ts` (`03 §7`: run samples through the REAL pipeline; backdate AccessEvents into hot/declining/stale/dead; idempotent delete-by-name guard).
- [ ] Run `prisma db seed` locally; verify the 4 Value profiles + a RETIRE candidate appear.
- [ ] Commit: `feat(api): seed samples with backdated usage profiles`.

**Task 3.3 — API client + query hooks (web)**
- Files: `apps/web/src/lib/api.ts` (typed fetch using `@assay/shared`; TanStack Query hooks; `retry:false`).
- [ ] Component/hook smoke test (MSW). Commit: `feat(web): typed API client and query hooks`.

**Task 3.4 — Catalog page**
- Files: `components/catalog/*`, `components/dataset/ScoreGauge` (inline), `SensitivityBadge`, `pages/CatalogPage.tsx` (`05 §4.1–4.4, §6a`).
- [ ] RTL test (`08 §5` Test A): catalog renders rows from mocked API; sort/filter drive query params.
- [ ] Implement (sortable score columns, PROCESSING/FAILED row states, sparkline). Commit: `feat(web): catalog dashboard with sortable scores`.

**Task 3.5 — Dataset detail + explain-score + charts**
- Files: `components/dataset/ScoreBreakdown`, `ColumnPanel`, `components/charts/*`, `pages/DatasetDetailPage.tsx` (`05 §4.5–4.7, §5, §6b`).
- [ ] RTL test (`08 §5` Test B): gauge is a button; "explain this score" popover reveals the `scoreBreakdown`.
- [ ] Implement gauges-as-buttons, breakdown popover, column table w/ expand + override control, usage chart, `healthNarrative` (or **R6** placeholder when null).
- [ ] Commit: `feat(web): dataset detail with score transparency and charts`.

### Phase 4 — Polish, edge cases, docs, ship (Day 5)

**Task 4.1 — Edge-case matrix green**
- Files: any gaps found via `08 §6` (empty, dup headers, ragged, all-null, oversized 413, non-CSV 415, mixed-type, dup rows).
- [ ] Run each sample + synthetic oversized/non-CSV; assert graceful behavior; add missing domain tests.
- [ ] Commit: `test: cover ingestion edge cases`.

**Task 4.2 — UX polish**
- Files: empty/loading/skeleton states (`05 §5.4`), reduced-motion, upload drag-drop + progress (`05 §7`), dark mode pass.
- [ ] Manual pass across both pages + a11y (keyboard, focus, ARIA per `05 §8`).
- [ ] Commit: `feat(web): loading/empty states, drag-drop upload, a11y polish`.

**Task 4.3 — README + assumptions**
- Files: `README.md` (setup/run, env matrix `09 §4`, **cold-start note verbatim `09 §7`**, design decisions distilled from `00–09`, assumptions incl. R7/R9/10 MiB cap, "AI tools used" disclosure).
- [ ] Commit: `docs: add README with setup, assumptions, and design decisions`.

**Task 4.4 — Ship + verify**
- [ ] Push; CI green; Render auto-deploys; run `prisma db seed` once via Render shell (`09 §6`); Vercel auto-deploys.
- [ ] Smoke test the live URL end-to-end (upload → catalog → detail → override → Value updates).
- [ ] Final commit-history review (incremental, conventional — 10% bucket).

---

## 4. Definition of Done (rubric self-check — `00 §14`)

- [ ] **Correctness 20%** — all 7 areas work; `domain/` unit tests + integration test green.
- [ ] **Structure 15%** — `routes→services→domain` clean; shared types; no logic in routes.
- [ ] **Edge cases 15%** — every `08 §6` row handled gracefully; no 500 on bad data.
- [ ] **Frontend UX 15%** — catalog + detail, gauges, explain-score, charts, dark mode, empty/loading states.
- [ ] **Deploy 10%** — live URL reachable, functions end-to-end; cold-start noted.
- [ ] **Git 10%** — incremental conventional commits across all phases.
- [ ] **README 15%** — setup, assumptions, deployment notes, design decisions.

## 5. Risks & watch-items

- **R8 (SDK shape)** is the top build-time risk — verify early (Task 2.5); the defensive parser + no-key default make it non-blocking.
- **Neon cold-start** on the demo — README note + optional `/api/health` warm-ping before a walkthrough (`09 §7`).
- **Scope creep** — the optional endpoints (`reprofile`, `delete`) and `ScoreSnapshot` sparkline are stretch; ship the 7 core areas first.
- **Fixture arithmetic** (R5) — keep one canonical worked example; a wrong assertion here reads as a scoring bug.

## 6. Execution handoff

Plan complete. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration (`superpowers:subagent-driven-development`).

**2. Inline Execution** — execute tasks in this session with checkpoints (`superpowers:executing-plans`).
