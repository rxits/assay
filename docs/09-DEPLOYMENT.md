# 09 — Deployment & Ops (assay)

> Purpose: the day-1 deploy + operations runbook for `assay`. **Derived from 00-SPEC.md** — stack (§4), monorepo layout (§5), API routes incl. `/api/health` (§7), and the AI-key rules (§8: env-only, server-side, never in repo). Read by the README and `10-BUILD-PLAN.md`. No code imports this doc.

Live deployment is a graded deliverable (00-SPEC §14, 10%). The strategy is **deploy on day 1, before features exist**, so the pipeline is de-risked while the surface area is a single `/api/health` route and an empty dashboard. Every later push then ships through a known-good path.

---

## 1. Topology

Three managed free-tier services, one responsibility each:

```
                         Browser
                            │  HTTPS
                            ▼
   ┌────────────────┐   GET/POST /api/*    ┌──────────────────────┐
   │  Vercel (web)  │ ───────────────────► │   Render (api)       │
   │  React + Vite  │   (VITE_API_URL,      │  Express + Prisma    │
   │  static / CDN  │    CORS-gated)        │  GET /api/health     │
   │                │ ◄─────────────────── │                      │
   └────────────────┘    JSON responses    └──────────┬───────────┘
                                                       │ DATABASE_URL
                                                       │ (pooled, TLS)
                                                       ▼
                                            ┌──────────────────────┐
                                            │   Neon (Postgres 16) │
                                            │   serverless,         │
                                            │   scale-to-zero       │
                                            └──────────────────────┘

   ANTHROPIC_API_KEY (optional) lives ONLY in Render's env ──► api ──► Claude Haiku
   (absent ⇒ app runs fully on the regex/heuristic fallback — 00-SPEC §8)
```

| Tier | Service | Why |
|---|---|---|
| Web (static) | **Vercel** (Hobby, free) | First-class Vite + pnpm-workspace support, global CDN, atomic instant rollback, auto-deploy on push. |
| API (compute) | **Render** (free web service) | Free Node web service with a real always-addressable URL, built-in health-check gate, one-click rollback, Git auto-deploy. Free tier sleeps after ~15 min idle → the cold-start note in §7. |
| Database | **Neon** (free) | Pinned by 00-SPEC §4. Serverless Postgres 16, scale-to-zero, connection pooler, and **no expiry**. |

**Why Neon and not Render's own free Postgres.** Render's free PostgreSQL instance is **deleted ~90 days after creation** — a hosted demo that reviewers may open weeks later would come back with a dead database. Neon's free tier is **persistent (no expiry)**, scales storage/compute to zero when idle (so it costs nothing while parked but survives), and ships a PgBouncer pooler that keeps Prisma from exhausting Postgres connections. Decoupling data (Neon) from compute (Render) also means the API can be rebuilt, rolled back, or re-pointed without ever touching the data. `api → Render` is disposable; `data → Neon` is durable.

> **Railway alternative.** If a non-sleeping API is preferred over strictly-free, swap Render for Railway (Hobby ~$5/mo) — identical build/start/root-dir settings below; only the dashboard changes. Railway removes the cold start (§7) at the cost of leaving the free tier. Default recommendation stays **Render** to keep the whole stack at $0.

---

## 2. Deploy order (day-1 checklist)

Provision in dependency order — each service needs the URL/secret of the one before it:

1. **Neon** → create project, copy the pooled `DATABASE_URL`.
2. **Render (api)** → set `DATABASE_URL` (+ optional `ANTHROPIC_API_KEY`), deploy, run first migration + seed, confirm `GET /api/health` = `200`. Note the public API URL.
3. **Vercel (web)** → set `VITE_API_URL` to the Render URL, deploy, note the `*.vercel.app` origin.
4. **Back to Render** → set `CORS_ORIGIN` to the Vercel origin, redeploy the api.
5. Smoke test: open the Vercel URL, confirm the catalog loads (seeded datasets) with no CORS errors in the console.

---

## 3. Step-by-step per service

Monorepo note: `assay` is a **pnpm workspace** (00-SPEC §5) — `apps/api`, `apps/web`, `packages/shared`. The lockfile and `pnpm-workspace.yaml` live at the **repo root**, and both apps import `packages/shared`. So installs run from the root and target one app with a path filter (`pnpm --filter ./apps/api …`); `packages/shared` is built first because both apps depend on it. `corepack enable` pins pnpm from the root `package.json` `"packageManager": "pnpm@11.6.0"` field.

### 3a. Neon (Postgres) — provision first

Managed — no build/start/root-dir. In the Neon console:

1. **New Project** → Postgres 16, region closest to the Render region (e.g. both in `us-west` / `Singapore`) to minimise query latency.
2. Use the default database (`neondb`) or create `assay`.
3. **Connection Details → Pooled connection** → copy the string (host contains `-pooler`, ends `?sslmode=require`). This is `DATABASE_URL`.
4. (Optional, recommended) also copy the **direct** (non-pooled) string as `DIRECT_URL` — see the pooling note in §6.

### 3b. Render (api) — Express + Prisma

New → **Web Service** → connect the GitHub repo.

| Setting | Value |
|---|---|
| Environment | Node |
| Region | match Neon's region |
| **Root Directory** | *(blank — repo root; the workspace lockfile + `packages/shared` live here)* |
| **Build Command** | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter ./packages/shared build && pnpm --filter ./apps/api exec prisma generate && pnpm --filter ./apps/api exec prisma migrate deploy && pnpm --filter ./apps/api build` |
| **Start Command** | `pnpm --filter ./apps/api start`  *(→ `node dist/index.js`)* |
| **Health Check Path** | `/api/health` |
| Instance Type | Free |
| Auto-Deploy | On (deploy on push to `main`) |

Notes:
- Root Directory is **blank on purpose**. Pointing it at `apps/api` would hide the workspace root and break the `packages/shared` import + the shared lockfile. Keep it at root and select the app with `--filter`.
- `prisma migrate deploy` runs inside the build so schema changes ship atomically with the code that needs them; it is idempotent and prompt-free (never resets — unlike `migrate dev`). Seed is a separate one-time step (§6), not part of the build.
- On the free tier (no Pre-Deploy hook) the migration lives in the build command as shown. If you later upgrade, move it to Render's **Pre-Deploy Command** so migrations run once per release rather than per build.

### 3c. Vercel (web) — React + Vite

New Project → import the repo.

| Setting | Value |
|---|---|
| Framework Preset | Vite |
| **Root Directory** | `apps/web`  *(tick "Include source files outside root" so the workspace + `packages/shared` resolve)* |
| Install Command | `pnpm install --frozen-lockfile`  *(Vercel runs it at the workspace root automatically)* |
| **Build Command** | `pnpm --filter ./packages/shared build && pnpm --filter ./apps/web build` |
| **Output Directory** | `dist`  *(Vite default)* |
| Node Version | 22.x |

Notes:
- SPA routing: add `apps/web/vercel.json` with a catch-all rewrite to `/index.html` so deep links (e.g. `/datasets/:id`) don't 404 on refresh.
- `VITE_API_URL` is the API's public base origin (no `/api` suffix); the api client composes `/api/...` paths from it. It is **build-time** — see §4.

---

## 4. Environment-variable matrix

Exactly six variables. Names are synthetic config keys; **no real values appear in this doc or the repo.**

| Variable | Service | Secret? | Where it's set | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | api (Render) | **Yes** | Render dashboard → Environment | Neon **pooled** string, `?sslmode=require`. Also add as a GitHub Actions secret only if CI ever runs migrations (§6 — it doesn't by default). |
| `ANTHROPIC_API_KEY` | api (Render) | **Yes** | Render dashboard → Environment **only** | **Optional.** See the call-out below. |
| `VITE_API_URL` | web (Vercel) | No (public) | Vercel dashboard → Environment | Base URL of the Render api, e.g. `https://assay-api.onrender.com`. **Build-time** — Vite inlines `VITE_*` into the browser bundle, so it is public and a change requires a **web redeploy**, not just a restart. Never put a secret in a `VITE_*` var. |
| `PORT` | api (Render) | No | Injected by Render automatically | App must `listen(process.env.PORT)` — do not hardcode. Local dev falls back to `4000`. |
| `NODE_ENV` | api (Render) + web build | No | Render: set `production`. Vercel: set automatically for prod builds | Gates production behaviour (error verbosity, Prisma logging). |
| `CORS_ORIGIN` | api (Render) | No | Render dashboard → Environment | The web origin, e.g. `https://assay.vercel.app`. Drives the Express CORS allowlist (§5). |

**`ANTHROPIC_API_KEY` — the graceful-degradation rule (00-SPEC §8, §2.3):**
- It lives **only** in the Render host dashboard. **Never** in git, `.env` (which is git-ignored), the client bundle, or a `VITE_*` var. The frontend never sees it — the Anthropic SDK is imported solely by `apps/api/src/lib/` server code.
- The app **runs fully without it.** When the key is unset, classification silently falls back to the regex/heuristic path and `healthNarrative` stays `null` (nullable by design, 00-SPEC §6). The live demo must never look broken because the key is absent — that is the whole point of it being optional.
- Set it only if you want AI-refined tags + narratives in the demo. Absence is a supported, tested state, not an error.

---

## 5. Secrets hygiene & CORS

### Secrets hygiene
- **`.env` is git-ignored.** Root `.gitignore` includes:
  ```gitignore
  .env
  .env.*
  !.env.example
  ```
- **`.env.example` is committed with empty placeholders** (secrets blank; non-secret defaults shown). One per app:

  `apps/api/.env.example`
  ```dotenv
  DATABASE_URL=
  ANTHROPIC_API_KEY=
  PORT=4000
  NODE_ENV=development
  CORS_ORIGIN=http://localhost:5173
  ```
  `apps/web/.env.example`
  ```dotenv
  VITE_API_URL=http://localhost:4000
  ```
- **Server-side-only key usage.** The Anthropic client is instantiated once in `apps/api/src/lib/` (per 00-SPEC §5) and imported by nothing in `apps/web`. Keys enter the process only via `process.env` on the host; they are never bundled, logged, or returned in an API response.
- Validate config at startup (fail-fast): assert `DATABASE_URL` is present and parse `PORT`; treat `ANTHROPIC_API_KEY` as optional. A missing `DATABASE_URL` should crash the boot loudly, not 500 on first request.

### CORS (web origin → api)
The api enables CORS for the single web origin. In `apps/api`:
```ts
import cors from "cors";
app.use(cors({ origin: process.env.CORS_ORIGIN, methods: ["GET", "POST", "PATCH", "DELETE"] }));
```
- Set `CORS_ORIGIN` to the exact Vercel production origin (scheme + host, no trailing slash), e.g. `https://assay.vercel.app`.
- **Preview caveat:** Vercel mints a unique origin per preview deploy. For the take-home the single production origin is sufficient; if previews must reach the api, widen `origin` to a function/allowlist matching `/\.vercel\.app$/` rather than using `*` (uploads are `POST` multipart — keep it scoped).

---

## 6. Release steps

**Migrations — `prisma migrate deploy`.** Applies all committed migrations in `apps/api/prisma/migrations`, in order, non-interactively. It never prompts and never resets the database (that is `migrate dev`, dev-only). It is idempotent — re-running when nothing is pending is a no-op. It runs inside the **Render build command** (§3b), so every deploy self-migrates; no manual step per release.

**Seed — first deploy only.** `apps/api/package.json` declares `"prisma": { "seed": "tsx prisma/seed.ts" }`. `seed.ts` loads the `samples/` datasets and backdated `AccessEvent`s (00-SPEC §10) — it is **not** idempotent, so it is **excluded from the build** to avoid duplicating rows on every deploy. Run it **once**, after the first successful deploy, via Render **Shell**:
```bash
pnpm --filter ./apps/api exec prisma db seed
```
Recommended hardening: guard `seed.ts` to no-op when `Dataset` rows already exist (`if ((await prisma.dataset.count()) > 0) return;`). Then it is safe to re-run and can be folded into the release step if desired. *(ponytail: guard-on-count is the smallest safe idempotency; only reach for per-dataset upserts if seeds need to evolve in place.)*

**How migrations run in CI/CD.** The platform owns migration execution, not CI: Render runs `migrate deploy` in each deploy's build against its `DATABASE_URL`. The GitHub Actions workflow (§8) is a **quality gate only** — install, typecheck, test — and deliberately does **not** touch the production database. Reasons: (a) Render/Vercel auto-deploy on push to `main`, so CI adding a deploy/migrate job would double-run; (b) keeping `DATABASE_URL` out of CI is one fewer place the secret lives. If migrations ever need to run *before* the app boots on multi-instance infra, promote them to a dedicated CI job or Render Pre-Deploy hook — unnecessary for a single free-tier instance (YAGNI).

**Neon pooling note (operational, not a new required var).** Prisma's `migrate` needs a **direct** connection, while the running app should use the **pooled** one. If migrations flake against the pooled host, add Neon's non-pooled string as `DIRECT_URL` and reference it in `schema.prisma`:
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // pooled — app runtime
  directUrl = env("DIRECT_URL")     // direct — migrate deploy
}
```
This keeps the canonical six-var matrix intact; `DIRECT_URL` is an optional Neon-specific add-on.

---

## 7. Cold-start note (exact README wording)

Paste this verbatim into the README so reviewers expect the delay:

> **Note on first load (free-tier cold start).** The API is hosted on Render's free tier, which spins the service down after ~15 minutes of inactivity, and the Neon database scales to zero when idle. **The first request after a period of inactivity takes about 20–30 seconds** while the API wakes and the database resumes; every request after that is fast. If the dashboard looks slow or empty on first load, wait a moment and refresh — this is expected free-tier behaviour, not a bug.

---

## 8. Health check & CI

### Health check wiring (`/api/health`)
- The api serves `GET /api/health` → `200 { "status": "ok" }` (00-SPEC §7). Keep it a **pure, DB-free liveness** check: returning without touching Postgres means the probe stays fast and does **not** wake Neon from scale-to-zero (which would defeat the point and add latency).
- **Render** → *Health Check Path* = `/api/health`. Render polls it; a failing check blocks a bad deploy from receiving traffic (zero-downtime gate) and restarts an unhealthy instance.
- A richer `GET /api/health/detailed` that runs `SELECT 1` may exist for manual debugging, but it is **not** wired to the platform probe, precisely so the liveness check never depends on a sleeping DB.
- **Vercel** (static CDN) needs no health check.

### Minimal GitHub Actions CI (install, typecheck, test on push)

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11.6.0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      # shared types + Prisma client must exist before typecheck
      - run: pnpm --filter ./packages/shared build
      - run: pnpm --filter ./apps/api exec prisma generate

      - run: pnpm -r typecheck
      - run: pnpm -r test
```
Deployment is intentionally absent — Render and Vercel auto-deploy on push to `main`. CI's only job is to keep `main` green (Vitest + Supertest + RTL, 00-SPEC §4).

---

## 9. Rollback & cost

### Rollback
| Layer | How | Speed |
|---|---|---|
| Web (Vercel) | **Instant Rollback** — promote a previous production deployment from the dashboard. No rebuild. | Seconds, atomic |
| API (Render) | **Rollback** to a prior successful deploy in the dashboard, or push a `git revert`. | ~1 build cycle (or instant re-point) |
| DB (Neon) | Keep migrations **backward-compatible** (additive) so a compute rollback stays schema-compatible. To undo a bad migration: `prisma migrate resolve --rolled-back <name>` then ship a corrective migration — avoid destructive changes. Optionally branch Neon before a risky migration for a snapshot to restore. | Minutes |

Golden rule: **never ship a destructive migration alongside the code that depends on it.** Additive-then-cutover keeps every rollback safe.

### Cost — all free tier
| Service | Tier | Cost | Relevant limit |
|---|---|---|---|
| Vercel | Hobby | **$0** | 100 GB bandwidth/mo — ample for a demo |
| Render | Free web service | **$0** | Sleeps after ~15 min idle (§7); 512 MB RAM |
| Neon | Free | **$0** | 0.5 GB storage, scale-to-zero, no expiry |
| **Total** | | **$0 / month** | |

Optional upgrade to remove the cold start: Render Starter or Railway Hobby (~$5–7/mo) keeps the api always-on; Neon and Vercel stay free. Not required for the graded submission.
