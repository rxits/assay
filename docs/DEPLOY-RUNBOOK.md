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

Note your Neon **region** — match it in step 2, and treat that as a hard requirement
rather than a preference. This deploy first ran with the API in Singapore and the database
in `us-east-1`: every catalog request took **2.5–3.0s** warm, because a handful of
sequential queries each pay a ~230ms round trip. Moving the database to the API's region
took the same requests to **0.8–1.3s** with no code change.

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
mkdir -p "$HOME/.local/bin" && corepack enable --install-directory "$HOME/.local/bin" && export PATH="$HOME/.local/bin:$PATH" && pnpm install --frozen-lockfile && pnpm --filter ./apps/api exec prisma migrate deploy && pnpm --filter ./apps/api exec prisma db seed && pnpm --filter ./apps/api build
```

`--install-directory` is not optional. A bare `corepack enable` writes its shims to
`/usr/bin`, which is read-only in Render's build image, and the build dies in ~8s with
`EROFS: read-only file system, unlink '/usr/bin/pnpm'`.

There is no explicit `prisma generate` — `apps/api`'s `postinstall` already runs it.

**Start Command**

```
node apps/api/dist/index.cjs
```

Running the built bundle directly means the *runtime* needs no pnpm on `PATH`, so the
corepack shim above matters only during the build.

Seeding runs inside the build, so **no shell access is required**. The seed is idempotent
(it deletes its own datasets by name first), so redeploys refresh the demo without
duplicating rows.

**Node version** comes from `.node-version` (`22`). Without it Render reads `engines.node`
and will happily install the newest major — it picked 26.5.0, which neither Prisma 5 nor
tsup are tested against.

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

Every build setting lives in `vercel.json` at the **repo root**, so there is nothing to
configure in the dashboard and the config is reviewable in git:

```jsonc
{
  "framework": "vite",
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm --filter ./apps/web build",
  "outputDirectory": "apps/web/dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

The deploy root is the **workspace root**, not `apps/web`. `@assay/web` depends on the
source-only `@assay/shared` package, so a build scoped to `apps/web` cannot resolve it.
The `rewrites` rule is what keeps deep links like `/datasets/<id>` from 404ing on reload.

```bash
vercel link --yes                                          # creates the project
printf 'https://<service>.onrender.com' | vercel env add VITE_API_URL production
vercel deploy --prod --yes
```

`VITE_API_URL` takes no trailing slash and no `/api`. Vite inlines it at **build** time,
so changing it later requires a redeploy, not just a restart.

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
| Build fails in ~8s, `EROFS ... unlink '/usr/bin/pnpm'` | Bare `corepack enable`. Use the `--install-directory` form in step 2. |
| Render installs Node 26.x | `.node-version` missing at the repo root. |
| Pushing to `main` doesn't redeploy | Render cloned the repo anonymously ("we don't have access to your repo"), so no webhook exists. Connect the GitHub app under **Settings → Build & Deploy**, or use **Manual Deploy**. |
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
