# Deploy Runbook (operational)

Step-by-step for taking `assay` live. Complements `09-DEPLOYMENT.md` (which explains the
*reasoning*); this file is the exact click-path with the values that actually work.

**Order matters** — each step needs a value produced by the one before it.

---

## Before you start

- `ADMIN_TOKEN` — generate with `openssl rand -hex 32`, keep it handy
- Groq key (optional) — <https://console.groq.com/keys>
- GitHub connected on both Render and Vercel

---

## 1. Neon (database)

1. <https://neon.tech> → **New Project** → Postgres 16
2. **Connection Details** → toggle **Connection pooling ON**
3. Click **Show password**, then **Copy snippet**

The host **must** contain `-pooler`. The direct (non-pooled) string exhausts connections
on a free dyno.

> If the Render build later fails during `prisma migrate deploy` with a connection/auth
> error, delete just `&channel_binding=require` from the string (keep `?sslmode=require`)
> and redeploy. That is the most common Neon + Prisma first-deploy hiccup.

Note your Neon **region** — match it in step 2.

---

## 2. Render (API)

<https://render.com> → **New → Web Service** → connect `rxits/assay`

| Setting | Value |
|---|---|
| **Root Directory** | **leave blank** (the pnpm workspace root) |
| Environment | Node |
| Region | match your Neon region |
| **Health Check Path** | `/api/health` |
| Instance Type | Free |

**Build Command**

```
corepack enable && pnpm install --frozen-lockfile && pnpm --filter ./apps/api exec prisma generate && pnpm --filter ./apps/api exec prisma migrate deploy && pnpm --filter ./apps/api exec prisma db seed && pnpm --filter ./apps/api build
```

**Start Command**

```
pnpm --filter ./apps/api start
```

Seeding runs inside the build, so **no shell access is required**. The seed is idempotent
(it deletes its own datasets by name first), so redeploys refresh the demo without
duplicating rows.

**Environment variables**

| Key | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Neon **pooled** string | required |
| `NODE_ENV` | `production` | required |
| `ADMIN_TOKEN` | your `openssl rand -hex 32` | without it destructive routes fail closed (403) |
| `MAX_UPLOAD_MB` | `25` | **required** — 512 MB dyno; the 100 MB default will OOM |
| `GROQ_API_KEY` | your Groq key | optional; unset ⇒ regex-only classification |

Verify: `https://<service>.onrender.com/api/health` → `{"status":"ok",...}`

---

## 3. Vercel (web)

<https://vercel.com> → **Add New → Project** → import `rxits/assay`

| Setting | Value |
|---|---|
| Framework Preset | **Vite** |
| **Root Directory** | `apps/web` — tick **"Include source files outside of the Root Directory"** |
| Install Command | `pnpm install --frozen-lockfile` |
| **Build Command** | `pnpm build` |
| Output Directory | `dist` |
| Node Version | 22.x |

**Environment variable**

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://<service>.onrender.com` — no trailing slash, no `/api` |

*Fallback if the build fails:* set Root Directory blank, Build Command
`pnpm --filter ./apps/web build`, Output Directory `apps/web/dist`.

---

## 4. Close the CORS loop

Back in **Render → Environment**:

| Key | Value |
|---|---|
| `CORS_ORIGIN` | `https://<project>.vercel.app` — exact origin, no trailing slash |

Then **Manual Deploy → Deploy latest commit**. Without this the browser blocks every API
call and the dashboard renders empty.

---

## 5. Smoke test

Open the Vercel URL. **First load takes 20–30s** (free-tier cold start — expected, and
documented in the README).

- Overview KPIs populate
- Catalog lists 5 datasets spanning KEEP / OPTIMIZE / ARCHIVE / RETIRE + a FAILED row
- Open a dataset → click a score gauge → the breakdown popover explains it
- Upload a CSV → it profiles and scores
- Settings loads; destructive actions need the admin token pasted under **Data → Admin token**

---

## 6. Finish the submission

Put the live URL in `README.md` under `## Live Demo` (replacing the placeholder). The brief
requires the hosted link in the README.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Dashboard empty, CORS errors in console | `CORS_ORIGIN` missing or mismatched — step 4 |
| Build fails at `prisma migrate deploy` | Used the direct Neon string, not pooled; or drop `&channel_binding=require` |
| API 502 / OOM on upload | `MAX_UPLOAD_MB` not set to `25` |
| Install fails resolving `xlsx` | Render can't reach `cdn.sheetjs.com` (we pin the patched SheetJS build there). Swap to `exceljs` if it persists. |
| Settings destructive actions return 403 | `ADMIN_TOKEN` unset on the API — by design (fail-closed). Set it, then paste it in Settings → Data. |
| Everything slow on first click | Free-tier cold start; Render sleeps after ~15 min idle. Expected. |

---

## Security reminders

- Secrets go **only** into the Render/Vercel env panels — never into git, never into a chat.
- `ADMIN_TOKEN` gates mutations under `/api/settings` and `/api/data`. Reads and uploads
  stay open so reviewers can use the demo.
- The demo persists ≤50 sample rows and ≤10 sample values per column, and it is public:
  **do not upload real personal data.**
