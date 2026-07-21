# 00 — Canonical Spec (`assay`)

> **This is the single source of truth.** Every other doc (01–10) derives its
> entity names, field names, enum values, formulas, and API routes from here.
> If a downstream doc needs to diverge, it must call out the divergence
> explicitly and say why. When in doubt, this file wins.

---

## 1. Identity

- **Name:** `assay` — *to assay* = to determine the quality, composition, and value of a material.
- **One-liner:** Upload a raw dataset; `assay` discovers its structure, flags sensitive fields, scores its quality, trust, and business value, and catalogs it in a browsable governance dashboard.
- **Assignment:** Proteccio "Data Governance Dashboard" — Full Stack Developer take-home.
- **Audience for the build:** reviewers grading a hire decision; a follow-up "walk us through your design" conversation is expected.

## 2. Guiding principles (locked)

1. **Flawless tight core beats ambitious-but-broken.** The brief explicitly rewards this. Extra scope earns **zero** rubric points and risks the correctness/edge-case buckets.
2. **"Crazy" = polish + a few tasteful differentiators, never more scope.**
3. **Everything degrades gracefully.** No feature may make the live demo look broken (esp. the AI layer — see §9).
4. **Transparency over black boxes.** Every score can explain itself.
5. **Judgment is the thing being tested** — handling messy data, a sensible API, a usable dashboard. Not CRUD boilerplate.

## 3. The 7 required areas → our features

| # | Brief area | What we build |
|---|---|---|
| 1 | Data Ingestion | Upload CSV/XLSX (`multer`); capture filename, upload time, size, row/col count. Stream-parse, cap oversized files. |
| 2 | Data Discovery | Infer per-column data types + profile; persist to a browsable catalog. |
| 3 | Data Classification | Auto-tag sensitive columns (regex + heuristics, optional AI refine); **manual override** required. |
| 4 | Data Quality | Per-column % missing, duplicate rows, invalid values → **Quality Score**. |
| 5 | Data Trust | **Trust Score** from quality + consistency + classification completeness. |
| 6 | Data Value | **Value Score** from access frequency + recency + trend → Keep/Optimize/Archive/Retire. |
| 7 | Dashboard | Catalog list (counts, tags, quality/trust/value, usage) → click → column-level detail. |

## 4. Tech stack (pinned)

| Layer | Choice | Version target |
|---|---|---|
| Runtime | Node.js | 22.x (dev machine: 22.23.1) |
| Package manager | pnpm workspaces | 11.x (11.6.0) |
| Language | TypeScript | 5.x, `strict` |
| API | Express | 4.x |
| ORM | Prisma | 5.x |
| DB | PostgreSQL | 16 (Neon serverless, free tier) |
| Upload | multer | 1.x |
| CSV parse | PapaParse | 5.x |
| XLSX parse | SheetJS (`xlsx`) | latest |
| AI (optional) | `@anthropic-ai/sdk`, model `claude-haiku-4-5-20251001` | latest |
| Client | React + Vite | React 18, Vite 5 |
| Styling | Tailwind + shadcn/ui | v3 / latest |
| Data fetching | TanStack Query | 5.x |
| Charts | Recharts | 2.x |
| Tests | Vitest (+ Supertest for API, RTL for components) | latest |

**Deviation note (for README):** brief says "Node/Express" — we match it exactly. We add TypeScript, Prisma, and a shared-types package for type-safety across the stack; every extra dep is justified in the README.

## 5. Monorepo layout (canonical)

```
assay/
├── docs/                     # the 10 planning docs (00–10)
├── apps/
│   ├── api/                  # Express + Prisma backend
│   │   ├── src/
│   │   │   ├── domain/       # PURE functions: profiling, classification, scoring, value — unit-tested
│   │   │   ├── services/     # orchestration: ingestion pipeline, catalog queries
│   │   │   ├── routes/       # thin Express handlers → services
│   │   │   ├── lib/          # prisma client, parsers, anthropic client, config
│   │   │   └── index.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── seed.ts       # loads sample datasets + backdated AccessEvents
│   │   └── tests/
│   └── web/                  # React + Vite frontend
│       ├── src/
│       │   ├── components/   # ui/ (shadcn), catalog/, dataset/, charts/
│       │   ├── pages/        # CatalogPage, DatasetDetailPage
│       │   ├── lib/          # api client, formatters
│       │   └── main.tsx
│       └── tests/
├── packages/
│   └── shared/               # shared TS types + enums (DTOs) imported by api AND web
├── samples/                  # messy sample datasets committed to the repo
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

**Separation of concerns (the 15% bucket):** `routes` (HTTP) → `services` (orchestration) → `domain` (pure logic). The pure `domain` layer is where scoring/classification live and is the primary unit-test target.

## 6. Canonical data model

Entities (Prisma models). **These names + fields are canonical — do not rename downstream.**

### `Dataset`
| field | type | notes |
|---|---|---|
| id | String (cuid) | PK |
| name | String | user-facing name (defaults to filename) |
| originalFilename | String | |
| fileType | `FileType` enum | `CSV` \| `XLSX` |
| sizeBytes | Int | |
| rowCount | Int | |
| columnCount | Int | |
| status | `DatasetStatus` enum | `PROCESSING` \| `READY` \| `FAILED` |
| qualityScore | Float? | 0–100 |
| trustScore | Float? | 0–100 |
| valueScore | Float? | 0–100 |
| valueRecommendation | `ValueRecommendation`? | `KEEP`\|`OPTIMIZE`\|`ARCHIVE`\|`RETIRE` |
| scoreBreakdown | Json? | component sub-scores for "explain this score" |
| healthNarrative | String? | AI-generated summary, nullable (graceful) |
| sampleRows | Json? | capped preview (≤50 rows) |
| errorMessage | String? | set when status=FAILED |
| uploadedAt | DateTime | default now |
| updatedAt | DateTime | @updatedAt |
| **relations** | | `columns[]`, `qualityChecks[]`, `accessEvents[]`, `scoreSnapshots[]` |

### `Column`
| field | type | notes |
|---|---|---|
| id | String (cuid) | PK |
| datasetId | String | FK → Dataset, cascade delete |
| name | String | original header |
| position | Int | ordinal, 0-based |
| dataType | `DataType` enum | `STRING`\|`INTEGER`\|`FLOAT`\|`BOOLEAN`\|`DATE`\|`DATETIME`\|`UNKNOWN` |
| missingCount | Int | |
| missingPct | Float | 0–1 |
| distinctCount | Int | |
| completeness | Float | 0–1 (non-null ratio) |
| validity | Float | 0–1 (values matching inferred type) |
| sampleValues | Json | ≤10 example values |
| **relations** | | `classificationTag?` (1:1), `dataset` |

### `ClassificationTag`
| field | type | notes |
|---|---|---|
| id | String (cuid) | PK |
| columnId | String @unique | FK → Column (one active tag per column) |
| category | `PiiCategory` enum | see §8 |
| sensitivity | `Sensitivity` enum | `NONE`\|`LOW`\|`MEDIUM`\|`HIGH` |
| source | `TagSource` enum | `AUTO_REGEX`\|`AUTO_AI`\|`MANUAL` |
| confidence | Float? | 0–1 |
| overridden | Boolean | default false; true after manual override |
| createdAt / updatedAt | DateTime | |

### `QualityCheck`
| field | type | notes |
|---|---|---|
| id | String (cuid) | PK |
| datasetId | String | FK → Dataset |
| columnId | String? | null = dataset-level (e.g. duplicate rows) |
| checkType | `QualityCheckType` enum | `MISSING_VALUES`\|`DUPLICATE_ROWS`\|`INVALID_VALUES`\|`TYPE_MISMATCH`\|`EMPTY_COLUMN`\|`DUPLICATE_HEADER` |
| severity | `Severity` enum | `INFO`\|`WARNING`\|`ERROR` |
| affectedCount | Int | |
| affectedPct | Float | 0–1 |
| detail | String | human-readable description |
| createdAt | DateTime | |

### `AccessEvent`  (powers Data Value)
| field | type | notes |
|---|---|---|
| id | String (cuid) | PK |
| datasetId | String | FK → Dataset |
| type | `AccessType` enum | `VIEW`\|`DETAIL_VIEW`\|`DOWNLOAD` |
| source | `AccessSource` enum | `SEED`\|`LIVE` |
| occurredAt | DateTime | **may be backdated** for seeds |

### `ScoreSnapshot`  (optional — enables value/quality trend sparkline)
| field | type | notes |
|---|---|---|
| id, datasetId | | FK → Dataset |
| qualityScore, trustScore, valueScore | Float | |
| capturedAt | DateTime | |

**Storage decision:** we do **not** persist all raw rows (arbitrary/huge, dynamic schema). At ingest we stream-parse, compute per-column aggregates + a capped `sampleRows` preview, and store only profiles + scores. This is what makes large-file handling safe.

## 7. Canonical API surface

Base: `/api`. JSON. Errors use a consistent shape `{ error: { code, message, details? } }`.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | liveness (for deploy checks) |
| `POST` | `/datasets` | multipart upload → run full pipeline → return dataset summary |
| `GET` | `/datasets` | catalog list; supports `?sort=`, `?sensitivity=`, `?recommendation=` |
| `GET` | `/datasets/:id` | full detail (columns, tags, checks, breakdowns, narrative, usage series). **Records a `DETAIL_VIEW` AccessEvent.** |
| `PATCH` | `/datasets/:id/columns/:columnId/classification` | manual tag override → recompute ClassificationCoverage + Trust |
| `GET` | `/datasets/:id/usage` | daily access time-series for the value chart (or embed in detail) |
| `POST` | `/datasets/:id/reprofile` | (optional) recompute scores |
| `DELETE` | `/datasets/:id` | (optional) remove dataset |

## 8. Classification (canonical categories)

`PiiCategory` enum → default sensitivity:

| Category | Default sensitivity |
|---|---|
| `EMAIL` | HIGH |
| `PHONE` | HIGH |
| `ID_NUMBER` | HIGH |
| `CREDIT_CARD` | HIGH |
| `DATE_OF_BIRTH` | HIGH |
| `NAME` | MEDIUM |
| `ADDRESS` | MEDIUM |
| `IP_ADDRESS` | MEDIUM |
| `POSTAL_CODE` | LOW |
| `NONE` | NONE |
| `OTHER` | LOW |

**Signals:** (a) header-name heuristic (column name regex), (b) value-pattern sampling (share of sampled non-null values matching a category regex; classify when ≥ `CLASSIFY_THRESHOLD = 0.70`). Confidence = match share. A column with a resolved tag (**including explicit `NONE`**) counts as "classified" for coverage.

**AI layer (optional, graceful — see principle §2.3):** only invoked for *ambiguous* columns (no category ≥ threshold, or header/value conflict) **and only if `ANTHROPIC_API_KEY` is set**. Calls Claude Haiku with column name + sample values → `{category, sensitivity, confidence}`; also generates the dataset `healthNarrative`. Results are **cached in the DB** (never re-charged on read). No key or any error → silent fallback to regex best-guess. **The key lives only in host env vars, never in the repo.**

## 9. Canonical scoring formulas

All inputs normalized to `[0,1]`; scores reported `0–100`. Weights live in one `config` object and are surfaced in-UI via "explain this score."

**Per-column (from profiling):**
- `completeness_col = nonNull / rowCount`
- `validity_col = matchesInferredType / nonNull`

**Dataset-level inputs:**
- `Completeness = mean(completeness_col)`
- `Validity = mean(validity_col)`  *(accuracy proxy)*
- `Uniqueness = 1 − duplicateRows / rowCount`
- `Consistency = mean(dominantTypeShare_col)` penalized by structural issues (duplicate/blank headers, ragged rows)
- `ClassificationCoverage = classifiedColumns / columnCount`

**Scores:**
```
Quality = 100 × (0.40·Completeness + 0.30·Validity + 0.30·Uniqueness)
Trust   = 100 × (0.45·(Quality/100) + 0.30·Consistency + 0.25·ClassificationCoverage)
Value   = 100 × (0.45·Frequency + 0.35·Recency + 0.20·Trend)
```
- `Frequency = min(1, log1p(accesses_90d) / log1p(FREQ_CAP))`, `FREQ_CAP = 50`
- `Recency = exp(−daysSinceLastAccess / HALFLIFE)`, `HALFLIFE = 30`
- `Trend = clamp01(0.5 + (accesses_last30 − accesses_prev30) / (2·max(1, accesses_prev30)))`

**Trust ⊇ Quality by design** (brief: trust is derived from quality + classification); **Value is fully independent** (usage only). That distinction is the point of the exercise.

**Value → recommendation:**
| Condition | Recommendation |
|---|---|
| 0 accesses in 90d **or** Value < 15 | `RETIRE` |
| Value 15–35 **and** declining trend | `ARCHIVE` |
| Value 35–60 | `OPTIMIZE` |
| Value ≥ 60 | `KEEP` |

## 10. Data Value seeding (so the live demo isn't empty)

`prisma/seed.ts` loads the sample datasets and generates backdated `AccessEvent`s (`source=SEED`) across ~90 days in distinct profiles: **hot** (frequent + recent), **declining** (busy then quiet), **stale** (sparse), **dead** (zero → RETIRE candidate). Live `DETAIL_VIEW`s (`source=LIVE`) append as reviewers click. Value recomputes on read.

## 11. Sample datasets (committed to `samples/`)

At least 4, each engineered to exercise edge cases:
1. `customers.csv` — clean-ish, obvious PII (email, phone, name) → high scores.
2. `messy_orders.csv` — missing values, duplicate rows, mixed types in a column, a blank column → low quality.
3. `employees.xlsx` — Excel path; DOB, national ID → high sensitivity.
4. `events_log.csv` — no PII, large-ish, used to show a "hot" dataset.
5. `broken.csv` — duplicate headers, ragged rows, empty file edge → tests graceful failure.

## 12. Non-goals (per brief — do NOT build)

No auth, no multi-user/RBAC, no realtime/websockets, no job queue (process inline; cap/stream large files), no production infra/observability stack. Keep it tight.

## 13. Naming & conventions

TS `strict`. `camelCase` values, `PascalCase` types/React components, `kebab-case` filenames (React components `PascalCase.tsx`). Enums `UPPER_SNAKE`. REST = plural nouns. Timestamps ISO-8601. Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).

## 14. Evaluation criteria → where addressed

| Criterion | Weight | Addressed by |
|---|---|---|
| Code structure & readability | 15% | monorepo, `domain/services/routes` split, shared types |
| Functional correctness | 20% | all 7 areas; tested scoring/classification |
| Data handling & edge cases | 15% | messy samples; empty/dup-header/ragged/large handling |
| Frontend UX | 15% | polished dashboard, gauges, viz, score transparency |
| Live deployment | 10% | deployed day 1; cold-start noted |
| Git hygiene | 10% | incremental conventional commits |
| Documentation (README) | 15% | these docs feed the README's design-decisions section |

## 15. Glossary

- **Data Trust** — "how *reliable* is this data?" Derived from quality checks + how completely it's classified. (Trust ⊇ Quality.)
- **Data Value** — "how much is this data actually *used/worth*?" Derived from access frequency + usage patterns. (Independent of quality.)
