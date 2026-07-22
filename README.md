# assay

**Upload a raw dataset; `assay` discovers its structure, flags sensitive fields, scores its quality, trust, and business value, and catalogs it in a browsable governance dashboard.**

> *to assay* — to determine the quality, composition, and value of a material.

A full-stack Data Governance Dashboard: a CSV/XLSX ingestion pipeline behind a
polished React catalog. Built for the Proteccio "Data Governance Dashboard"
take-home.

---

## Live Demo

**<https://assay-one.vercel.app>** — dashboard, catalog and upload, seeded with five
datasets that between them cover every recommendation band and one deliberate parse
failure.

The API is separate: **<https://assay-uu55.onrender.com/api/health>**.

> **Note on first load (free-tier cold start).** The API is hosted on Render's free tier, which spins the service down after ~15 minutes of inactivity, and the Neon database scales to zero when idle. **The first request after a period of inactivity takes about 20–30 seconds** while the API wakes and the database resumes; every request after that is fast. If the dashboard looks slow or empty on first load, wait a moment and refresh — this is expected free-tier behaviour, not a bug.

---

## What it does

Upload a messy CSV or XLSX and `assay` runs an inline pipeline covering the
seven required governance areas:

| # | Area | What it does |
|---|------|--------------|
| 1 | **Ingestion** | Multipart upload (CSV/XLSX), captures filename, size, row/column counts; parses in memory behind a hard size cap. |
| 2 | **Discovery** | Infers per-column data type and profiles completeness, distinct count, validity, and sample values. |
| 3 | **Classification** | Auto-tags sensitive columns (email, phone, national ID, credit card, DOB, name, address…) by header + value-pattern signals, with a **manual override** on every column. |
| 4 | **Quality** | Per-column missing/invalid values, dataset-level duplicate rows and structural defects → a **Quality Score**. |
| 5 | **Trust** | A **Trust Score** derived from quality, structural consistency, and classification coverage. |
| 6 | **Value** | A **Value Score** from access frequency, recency, and trend → a Keep / Optimize / Archive / Retire recommendation. |
| 7 | **Dashboard** | A sortable, filterable catalog → click into column-level detail with score-transparency popovers and charts. |

### The distinction being tested: Trust vs Value

The interesting judgment in this brief is that **quality, trust, and value are
three different questions** — and two of them are commonly conflated:

> - **Data Trust** — *"how reliable is this data?"* Derived from quality checks + how completely it's classified. (Trust ⊇ Quality.)
> - **Data Value** — *"how much is this data actually used/worth?"* Derived from access frequency + usage patterns. (Independent of quality.)
>
> — *canonical spec §15*

So **Trust is a superset of Quality** (a clean, fully-classified dataset earns
trust), while **Value is orthogonal to both** — a pristine table nobody queries
is low-value, and a messy one everybody hits is high-value. `assay` scores them
on independent inputs so the catalog can surface a *high-quality, unused*
dataset as a `RETIRE` candidate. That separation is the point of the exercise.

---

## Scoring

All inputs are normalized to `[0,1]`; scores are reported `0–100`. Every weight
lives in one `config` object and is surfaced in the UI via **"explain this
score"** — click any gauge to see the exact sub-scores and weights that produced
the number. Nothing is a black box.

```
Quality = 100 × (0.40·Completeness + 0.30·Validity   + 0.30·Uniqueness)
Trust   = 100 × (0.45·(Quality/100) + 0.30·Consistency + 0.25·ClassificationCoverage)
Value   = 100 × (0.45·Frequency     + 0.35·Recency     + 0.20·Trend)
```

**Quality / Trust inputs** — `Completeness` = mean non-null ratio;
`Validity` = share of values matching the inferred type; `Uniqueness` =
`1 − duplicateRows/rowCount`; `Consistency` = mean dominant-type share, penalized
by structural defects (duplicate/blank headers, ragged rows); `ClassificationCoverage`
= classified columns / total.

**Value inputs** (usage only):

- `Frequency = min(1, log1p(accesses_90d) / log1p(50))`
- `Recency   = exp(−daysSinceLastAccess / 30)`
- `Trend     = clamp01(0.5 + (accesses_last30 − accesses_prev30) / (2·max(1, accesses_prev30)))`

**Value → recommendation** (evaluated top-down):

| Condition | Recommendation |
|---|---|
| 0 accesses in 90d **or** Value < 15 | `RETIRE` |
| Value 15–35 **and** declining trend | `ARCHIVE` |
| Value 35–60 | `OPTIMIZE` |
| Value ≥ 60 | `KEEP` |

The scoring engine lives in a **pure, unit-tested** `domain/` layer — every
number above is asserted against a worked example (see [Testing](#testing)).

---

## Tech stack & why

The brief specified "Node/Express" and asked that any additions be justified.
Here's every non-obvious dependency and the reason it earns its place:

| Choice | Why |
|---|---|
| **TypeScript** (strict) | The whole app is a data pipeline with typed shapes (profiles, tags, scores). `strict` + `noUncheckedIndexedAccess` catches the ragged-row / null-cell class of bug at compile time — exactly the edge cases the brief grades. |
| **Prisma** (+ PostgreSQL) | Type-safe schema, generated client, and versioned migrations. The domain is relational (Dataset → Column → Tag/Check/AccessEvent), so a real DB with FKs and cascades beats hand-rolled SQL, and the generated types line up with the shared DTOs. |
| **`@assay/shared` types package** | One wire contract (DTOs + string-literal enums) imported by **both** API and web, so a route response and its React consumer can never drift. A response shape change is a compile error on both sides. |
| **source-only shared** (no build step) | `@assay/shared` is **types-only** (interfaces + unions, zero runtime code) and its `exports` point straight at `./src/index.ts`. The bundlers (below) compile it inline, so there's no `dist/`, no watch step, and no stale build to forget. |
| **tsup** (API bundler) | Bundles the API — including the shared source — into a single `dist/index.cjs` via esbuild in ~50ms. No `ts-node` in prod, no `tsc` project-references dance; the deploy artifact is one file. |
| **TanStack Query** | Server state (catalog, detail, usage) is cache-first with request de-dupe, background refetch, and per-query loading/error states — which drive the skeleton/empty/error UI. `retry:false` makes the cold-start error surface immediately rather than hang. |
| **Recharts** | Declarative, composable SVG charts (usage area, type-distribution bar, histogram) that theme cleanly off CSS variables and respect the reduced-motion pass. |
| **Tailwind + shadcn/ui** | A token-driven design system: one set of semantic CSS variables themes light/dark, and primitives stay copy-owned in-repo (no runtime UI dependency to fight). |
| **multer · PapaParse · SheetJS** | The ingestion boundary: streamed multipart upload, robust CSV parsing, and first-sheet XLSX extraction. |
| **`openai` SDK → Groq** (optional) | Refines *ambiguous* column tags and writes a one-line health narrative — **only** when a key is present. Groq speaks the OpenAI Chat Completions API, so the provider is a `baseURL` (`LLM_BASE_URL`) and the model an env var (`LLM_MODEL`), not a code dependency. Fully optional (see below). |

**Architecture** — a clean `routes → services → domain` split:

```
apps/api/src/
  routes/     thin Express handlers  (HTTP, multer, zod, error envelope)
  services/   orchestration          (ingest pipeline, catalog queries, persistence)
  domain/     PURE functions         (profiling, classification, quality, scoring) — unit-tested
  lib/        config, prisma, parsers, optional LLM client (Groq)
```

All judgment (scoring, classification) lives in `domain/` with no I/O, so it's
deterministic and cheap to test. See [`docs/`](#design-decisions--trade-offs)
for the full architecture package.

---

## Setup / run locally

**Prerequisites:** Node 22, pnpm 11 (via `corepack`), and Docker (or any
PostgreSQL 16).

```bash
# 1. Install (pnpm is pinned in package.json; corepack activates it)
corepack enable
pnpm install

# 2. Start Postgres — Docker (any Postgres 16 works; note the 5434 host port)
docker run --name assay-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=assay \
  -p 5434:5432 -d postgres:16

# 3. Configure the API. The example DATABASE_URL already points at the container above,
#    so this works as-is for local development.
cp apps/api/.env.example apps/api/.env

# 4. Apply migrations and seed the sample datasets + backdated usage
pnpm --filter @assay/api exec prisma migrate dev
pnpm --filter @assay/api exec prisma db seed

# 5. Run API (:4000) + web (:5173) together
pnpm dev
```

Open **http://localhost:5173**. The catalog loads with five seeded datasets
spanning the full `KEEP / OPTIMIZE / ARCHIVE / RETIRE` spread plus a `FAILED`
example.

**Optional — the web `.env`.** The client defaults to `http://localhost:4000`,
so no config is needed locally. To point elsewhere: `cp apps/web/.env.example
apps/web/.env` and set `VITE_API_URL`.

**Optional — AI enrichment.** Set `GROQ_API_KEY` in `apps/api/.env` to
enable LLM-refined tags on ambiguous columns and the health narrative.
**Without a key the app runs fully** on the regex/heuristic classifier — the AI
layer is a graceful enhancement, never a requirement (see below).

---

## Assumptions

Documented decisions where the brief left room, so a reviewer knows they were
deliberate, not accidental:

- **XLSX: first sheet only.** A workbook's first sheet is treated as the
  dataset; other sheets are ignored (noted in the upload UI).
- **Per-type validity rules.** A value is "valid" against its inferred type by:
  `INTEGER` `/^-?\d+$/`; `FLOAT` finite `Number()`; `BOOLEAN` ∈
  {true,false,0,1,yes,no}; `DATE`/`DATETIME` a parseable date; `STRING`/`UNKNOWN`
  always valid. `Validity` is the share of a column's values that pass.
- **Upload cap of `MAX_UPLOAD_MB` (default 100).** Enforced at the multipart
  boundary; a larger file is rejected with `413 file_too_large` before any
  parsing. See [Security](#security) for the recommended free-tier value.
- **Brand-new datasets read `RETIRE` until first viewed — by design.** Value is
  driven purely by access events; a just-uploaded dataset has none, so it scores
  low and reads `RETIRE` until it's opened (which records its first view). Seeds
  ship with backdated history so the demo shows a full spread immediately. No
  artificial grace period — that would diverge from the Value formula.
- **AI is optional and graceful.** No `GROQ_API_KEY` ⇒ classification falls
  back to regex/heuristics and `healthNarrative` stays null (the UI shows a
  neutral placeholder). Absence is a supported, tested state — never an error.
- **Classification coverage is effectively 1.0.** Auto-classification resolves
  *every* column to a tag, including an explicit `NONE` for non-sensitive
  columns — and an explicit `NONE` counts as "classified" for coverage. So on a
  `READY` dataset, `ClassificationCoverage` is 1.0 by construction; it's modelled
  as a governance metric that *would* drop if a column were left untagged, and it
  keeps the Trust formula honest to the spec.

---

## Design decisions & trade-offs

- **Compute-on-ingest; no raw rows persisted.** Uploaded rows are streamed,
  profiled into per-column aggregates + scores + a capped ≤50-row preview, and
  then discarded. We never store the arbitrary, potentially-huge raw table. This
  is what makes large-file handling safe and keeps the schema fixed regardless of
  the uploaded shape — at the cost of not being able to re-query raw values
  later (out of scope for a governance catalog).
- **A pure `domain/` core behind thin routes.** `routes → services → domain`.
  All scoring/classification judgment is pure functions with no DB or HTTP, so
  the 20% correctness bucket is guarded by fast, deterministic unit tests and the
  routes stay trivial.
- **The AI layer is optional and server-side only.** The LLM client is
  instantiated once in `apps/api/src/lib/llm.ts` and imported by nothing in the web
  app. The key enters only via host env vars — never bundled, logged, or
  returned. The app degrades to the regex classifier the instant the key or the
  network is absent, so the live demo can never look broken because of it.
- **Failure is a first-class catalog state, not a 500.** A non-rectangular or
  unparseable file becomes a catalogued `FAILED` dataset with a readable
  `errorMessage` and null scores — a bad upload never crashes the request.

The full design package (spec, architecture + ADRs, data model, API design,
design system, scoring engine, classification, testing, deployment, build plan)
lives in [`docs/00`–`docs/10`](./docs).

---

## Security

This is a public, deliberately **unauthenticated** demo. That is a scoping
decision, not an omission — so here is exactly what is and isn't protected.

### No auth, by design

The brief scopes user accounts out, and a reviewer must be able to open the
deployed URL and *use* it. So **reads and uploads are intentionally open**:
anyone with the link can browse the catalog, upload a file, and override a
classification. What is *not* open is the ability to wipe or re-tune the shared
catalog from a URL bar.

### `ADMIN_TOKEN` — the gate on destructive routes

Mutating requests under `/api/settings` (scoring-weight changes, rescore) and
`/api/data` (reset/wipe) go through an admin gate. Safe methods
(`GET`/`HEAD`/`OPTIONS`) are never gated. Three behaviours:

| `ADMIN_TOKEN` | Behaviour |
|---|---|
| **Set** | An `x-admin-token` header must match, compared in constant time (both sides SHA-256'd first, so a length mismatch can't leak the token's length). Missing/wrong ⇒ `401 admin_token_required`. |
| **Unset, `NODE_ENV=production`** | **Fails closed** — `403 admin_disabled`. An unset secret in production is far likelier to be an oversight than a decision, and a public demo anyone can empty with one `curl -X DELETE` is worse than one with a disabled danger zone. |
| **Unset, dev/test** | Allowed, with a one-line warning at boot (`apps/api/src/index.ts`), so local work and the test suite need no ceremony. |

Generate one with `openssl rand -hex 32` and set it **on the API host only** —
it is a server-side secret and is never bundled into the web app. The Settings
page prompts for it and sends it per-request.

Both gates are mounted **by path prefix** in `createApp()`, not decorated per
route, so a route added under those prefixes later is protected by default.

### Transport & request hardening

- **`helmet()`** default security headers; `x-powered-by` disabled.
- **CORS pinned to `CORS_ORIGIN`** (single origin), methods limited to
  `GET/POST/PATCH/DELETE`.
- **1 MB JSON body cap** — JSON bodies here are settings patches and
  classification overrides, a few hundred bytes; uploads take the multipart
  path and multer's own cap.
- **`trust proxy: 1`** — exactly the one TLS-terminating hop in front of the
  API, so the rate limiters bucket real client IPs instead of lumping the
  world into the proxy.

### Rate limiting

Two `express-rate-limit` layers, both `429 rate_limited`:

| Limiter | Budget | Scope |
|---|---|---|
| Global | 600 / 15 min / IP | Every request. Sized for a human with the dashboard open (the Settings page polls `/api/system`), not a scraper. |
| Mutation | **30 / 15 min / IP** | Non-safe methods only. Every mutation either burns CPU (a large parse, a full-catalog rescore) or changes shared state. |

Uploads and classification overrides stay open, but they sit behind the
mutation limiter. Both limiters are skipped when `NODE_ENV=test` (a suite fires
hundreds of requests from one IP by design).

### PII posture — read this before uploading anything

**Do not upload real personal data to a public deployment.** The demo is
unauthenticated, so anything persisted is world-readable to anyone with the
link. Concretely, ingestion keeps:

- **≤ 50 sample rows per dataset** (the detail-page preview), and
- **≤ 10 distinct sample values per column** (shown in the column profile).

Those caps are structural (`INGEST` in `apps/api/src/lib/config.ts`) — reported
read-only by `GET /api/system`, deliberately *not* runtime-tunable. Everything
else is aggregate: the raw table is profiled and discarded, never stored.

**What leaves the server:** nothing, unless `GROQ_API_KEY` is set. With no key,
classification is pure regex/heuristics and the API makes no outbound calls at
all. With a key set, **≤ 10 sampled values from *ambiguous columns only*** are
sent to Groq for tag refinement — a column the regex classifier already
resolved is never sent. The health narrative sends an aggregate summary (row
and column counts, scores, duplicate count, sensitive-category names) and no
cell values. No sampled value is ever logged, on success or failure.

### Upload limits

`MAX_UPLOAD_MB` (default **100**) caps the multipart boundary; oversize files
are rejected `413 file_too_large` before any parsing. On a **512 MB free-tier
host, lower it to ~25** — parsing is in-memory, and a 100 MB workbook will
outgrow the dyno before the cap ever fires.

### Known advisories (`pnpm audit`)

The two SheetJS advisories on the production path — prototype pollution
([GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6),
`<0.19.3`) and ReDoS
([GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9),
`<0.20.2`) — **are patched**. SheetJS pulled all releases `>=0.19` from npm, so
`xlsx` is pinned to the vendor CDN tarball (`xlsx-0.20.3.tgz`) — the only place
the fixed build exists.

Five findings remain, **all `devDependencies`, none reachable in production**
(the deployed API is a single `tsup`-bundled `dist/index.cjs`; none of these
packages ship in it):

| Severity | Package | Advisory | Path |
|---|---|---|---|
| critical | `vitest` `<3.2.6` | [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp) — arbitrary file read/execute **when the Vitest UI server is listening** | `vitest` |
| high | `vite` `<=6.4.2` | [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) — `server.fs.deny` bypass on Windows | `vitest > vite` |
| moderate | `vite` `<=6.4.2` | [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) — `launch-editor` NTLMv2 disclosure on Windows | `vitest > vite` |
| moderate | `vite` `<=6.4.1` | [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) — path traversal in optimized-deps `.map` handling | `vitest > vite` |
| moderate | `esbuild` `<=0.24.2` | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — dev server accepts cross-origin requests | `vitest > vite > esbuild` |

All five resolve to one root: **`vitest` 2.x**. The fix is a major bump to
`vitest` 3, which is a real regression risk across 117 tests to close advisories
that require running the Vitest UI or a Vite dev server — neither of which we
run, in CI or anywhere else. Deliberately deferred, not missed. The `esbuild`
advisory that *did* reach the API's build chain (`tsup > esbuild`,
[GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)) is
patched via a workspace `overrides` pin to `0.28.1`, since `tsup` 8.5 still
caps at `^0.27`.

---

## Testing

```bash
pnpm test                        # everything (needs the local Postgres running)
pnpm --filter @assay/api test    # API: domain units + route integration
pnpm --filter @assay/web test    # web: component tests
pnpm -r typecheck                # strict tsc across all packages
```

**What's covered:**

- **Pure domain units** (the bulk) — scoring formulas against worked examples,
  classification true-positives *and* false-positives (the surrogate-key /
  DOB-vs-date / Luhn guards), type inference, and quality checks.
- **Route integration** (Supertest + real Prisma) — a real upload lands in the
  catalog with correct counts, scores, and PII tags; plus the ingestion
  **edge-case matrix**: empty file, duplicate headers, ragged rows, all-null
  column, oversized → `413`, non-CSV/XLSX → `415`, mixed-type, duplicate rows.
- **Web components** (React Testing Library + MSW) — the catalog renders API
  rows, and the "explain this score" popover reveals the same breakdown the
  scoring tests assert.

**CI** — [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs
`install → prisma generate → migrate deploy → typecheck → test` against an
ephemeral Postgres service on every push and PR. It's a quality gate only and
never touches the production database.

---

## Deployment

Three managed free-tier services, one responsibility each — see
[`docs/09-DEPLOYMENT.md`](./docs/09-DEPLOYMENT.md) for the full runbook.

```
  Vercel (web, static)  ──►  Render (api, Express+Prisma)  ──►  Neon (Postgres 16)
   React + Vite CDN           GET/POST /api/*                    serverless, scale-to-zero
```

**Environment variables** (four required, six optional; secrets live only in
host dashboards, never in the repo — see [Security](#security)):

| Variable | Service | Required | Notes |
|---|---|---|---|
| `DATABASE_URL` | Render | ✅ | Neon **pooled** connection string. |
| `VITE_API_URL` | Vercel | ✅ | Public base URL of the API (build-time; inlined). |
| `CORS_ORIGIN` | Render | ✅ | The Vercel web origin, for the CORS allowlist. |
| `NODE_ENV` | both | ✅ | `production` in deploys. Also flips the admin gate to fail-closed. |
| `PORT` | Render | — | Injected by the platform; falls back to `4000`. |
| `ADMIN_TOKEN` | Render | ⚠️ | Shared secret for mutations under `/api/settings` and `/api/data`. `openssl rand -hex 32`. **Unset in production ⇒ those routes return `403`.** API host only. |
| `GROQ_API_KEY` | Render | — | **Optional**, server-side only — enables LLM tag refinement on ambiguous columns and the health narrative. Unset ⇒ regex-only, zero outbound calls. |
| `LLM_BASE_URL` | Render | — | OpenAI-compatible endpoint. Default `https://api.groq.com/openai/v1`; set it to point at any other compatible host. |
| `LLM_MODEL` | Render | — | Default `llama-3.3-70b-versatile`. |
| `MAX_UPLOAD_MB` | Render | — | Multipart upload cap, default `100`. **Set ~`25` on a 512 MB free-tier host** — parsing is in-memory. |

**Build note — omit the shared build step.** `docs/09` sketches a
`pnpm --filter ./packages/shared build` step; the implementation makes it
unnecessary. `@assay/shared` is **source-only types**, so the actual build
commands drop it — the bundlers compile the shared source inline:

- **Render (api):** `pnpm install --frozen-lockfile && pnpm --filter ./apps/api exec prisma generate && pnpm --filter ./apps/api exec prisma migrate deploy && pnpm --filter ./apps/api build`
- **Vercel (web):** `pnpm --filter ./apps/web build` (Root Directory `apps/web`, "include files outside root" on).

Seed runs **once** after the first deploy (via Render Shell:
`pnpm --filter ./apps/api exec prisma db seed`), not in the build.

---

## AI tools disclosure

This project was built with **Claude Code** (Anthropic) as a pair — planning,
implementation, and tests. The design decisions are mine and I'm happy to walk
through any of them (the `domain/` layer, the Trust-vs-Value split, the scoring
weights, or any trade-off above) in a follow-up conversation.
