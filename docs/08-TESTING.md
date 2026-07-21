# 08 — Testing Strategy (assay)

> Purpose: how we test `assay` to defend the correctness + edge-case rubric with the fewest, highest-signal tests. **Derived from 00-SPEC.md** (formulas §9, classification §8, entities §6, `domain/services/routes` layering §5).

> Note on worked examples: doc 06 isn't written yet, so every number below is computed **directly from SPEC §9** (the canonical source 06 will also derive from). No divergence — same formulas, same weights.

---

## 1. Test philosophy

The brief rewards a **flawless tight core** and asks for only **1–2 meaningful tests**. So we spend the test budget where a bug is most likely and most damaging: the **pure `domain/` functions** (§5) — scoring and classification — where all the real judgment lives and where I/O never intrudes.

Principles:

1. **Maximize signal per test.** A pure function with a known input→output is the cheapest place to catch a real bug. One `scoreQuality` test guards the whole 20% correctness bucket for Data Quality.
2. **Pure functions first.** `domain/` has no DB, no HTTP, no mocks — tests are deterministic and fast. Every score is a rational number we can assert exactly (SPEC §9 is fully specified).
3. **Test behavior, not implementation.** Assert the *score the SPEC promises*, the *category the SPEC promises* — never internal call counts or private helpers.
4. **Tie every test to a rubric bucket:**
   - **Functional correctness (20%)** → scoring formulas (§9) + classification (§8) unit tests, and the upload→catalog integration test.
   - **Data handling & edge cases (15%)** → the edge-case matrix (§6 below): empty file, duplicate headers, ragged rows, all-null column, oversized cap, non-CSV/XLSX rejection.
5. **Transparency is testable (SPEC §2.4, §9).** "Explain this score" surfaces the same sub-scores our tests assert — the popover test and the scoring test check the *same* breakdown object.

**The two "meaningful" tests we commit to** (the ones the brief asks for) are the two full files in §8–§9:
`domain/scoring.test.ts` (correctness of the three scores + the empty-dataset edge) and
`routes/datasets.integration.test.ts` (a real upload lands in the catalog with correct counts/scores/tags).
Everything else in this doc is a documented matrix we fill in as ROI allows — cheap, because `domain/` is pure.

---

## 2. The test pyramid for this app

```
        ┌───────────────────────────┐
   thin │  2 component tests (RTL)   │  catalog renders rows · "explain score" popover
        ├───────────────────────────┤
     1  │  1 integration test        │  Supertest: POST /datasets → GET /datasets
        │  (routes→services→domain→DB)│  real Prisma against a throwaway test DB
        ├───────────────────────────┤
        │  many unit tests (domain/) │  scoring · classification · type inference · quality checks
   base │  pure, fast, deterministic │  the bulk of the value — no I/O, no mocks
        └───────────────────────────┘
                (no E2E — SPEC §12 non-goal; Playwright would be flaky for a take-home)
```

- **Base — unit (`apps/api/src/domain/*.test.ts`), co-located.** The primary target (SPEC §5, §14). Pure functions → exact assertions, milliseconds, zero setup.
- **Middle — one integration (`apps/api/tests/routes/*.integration.test.ts`).** Proves the pipeline wires together: `multer` → parse → profile → classify → score → persist → catalog read. One well-chosen test covers the whole happy path plus the rejection edge.
- **Top — two component tests (`apps/web/src/**/*.test.tsx`) with RTL.** Just enough to prove the dashboard renders catalog data and the score-transparency affordance works. No snapshot tests (they rot; SPEC values change).
- **No E2E.** SPEC §12 lists no realtime/infra; a browser flow adds flake and reviewer setup cost for zero extra rubric points.

---

## 3. Unit targets (the base — concrete cases)

All targets are pure functions in `apps/api/src/domain/`. Intended module APIs are defined by these tests (TDD: the test is written first and defines the signature).

### 3.1 Scoring (`domain/scoring.ts`) — assert the SPEC §9 worked examples

**Weights (one `config` object, surfaced in "explain this score"):**
Quality `0.40·Completeness + 0.30·Validity + 0.30·Uniqueness`;
Trust `0.45·(Quality/100) + 0.30·Consistency + 0.25·ClassificationCoverage`;
Value `0.45·Frequency + 0.35·Recency + 0.20·Trend`; `FREQ_CAP=50`, `HALFLIFE=30`.

**Quality / Trust — `customers.csv` profile** (100 rows, 4 cols, 10 duplicate rows; `completeness_col=[1,1,.9,.9]`, all valid, clean structure, all 4 columns classified):

| Input | Value | Source |
|---|---|---|
| Completeness = mean(1,1,.9,.9) | 0.95 | §9 |
| Validity = mean(1,1,1,1) | 1.00 | §9 |
| Uniqueness = 1 − 10/100 | 0.90 | §9 |
| **Quality** = 100·(0.40·.95 + 0.30·1 + 0.30·.90) | **95.0** | assertion |
| Consistency = mean dominantTypeShare, no structural penalty | 1.00 | §9 |
| ClassificationCoverage = 4/4 | 1.00 | §9 |
| **Trust** = 100·(0.45·.95 + 0.30·1 + 0.25·1) | **97.75** | assertion |

Structural-penalty case (ragged rows / dup headers scale Consistency): `structuralPenalty=0.8` → Consistency 0.80 → **Trust 91.75**.

**Value + recommendation (§9 table, evaluated top-down: RETIRE → ARCHIVE → OPTIMIZE → KEEP):**

| Profile | Frequency | Recency | Trend | Value | Rec |
|---|---|---|---|---|---|
| **hot** (90d=50, last30=20, prev30=15, days=1) | 1.000 | exp(−1/30)=0.9672 | 0.6667 | **92.19** | `KEEP` (≥60) |
| **dead** (90d=0, never accessed) | 0 | 0 (null→0 guard) | 0.5 | **10.0** | `RETIRE` (0 in 90d) |
| **declining** (90d=3, last30=0, prev30=3, days=45) | 0.3526 | exp(−1.5)=0.2231 | 0.0 | **23.68** | `ARCHIVE` (15–35 & declining) |
| optimize (90d=6, last30=1, prev30=5, days=25) | 0.4949 | 0.4346 | 0.10 | **39.48** | `OPTIMIZE` (35–60) — *declining but still >35* |

**Empty-dataset edge (the graceful-degradation guard, SPEC §2.3, §6 nullable score fields):**
`scoreQuality` / `scoreTrust` must return **`null`**, never `NaN`/`Infinity`, when `rowCount === 0` (or `columnCount === 0`) — division by zero in `nonNull/rowCount`. A dataset whose columns are all-null but has rows is **not** null; it's a valid low score (covered in the edge matrix). `scoreValue` of a never-accessed dataset returns a real number (10.0) and `RETIRE`.

### 3.2 Classification (`domain/classification.ts`) — true positives AND false positives per category

Two signals (§8): header-name regex + value-pattern share (classify when share ≥ `CLASSIFY_THRESHOLD = 0.70`; `confidence = share`). The **false-positive** rows are the point — precision is what separates a real classifier from a keyword match.

| Category (default sensitivity) | True positive (matches) | False positive (must NOT match) — why |
|---|---|---|
| `EMAIL` (HIGH) | `ada@x.io` | `@handle`, `a@b` — no TLD; `not-an-email` |
| `PHONE` (HIGH) | `+1 (415) 555-0132`, `9876543210` | `1234` — <10 digits; a date `2020-01-01`; a 16-digit card |
| `ID_NUMBER` (HIGH) | SSN `123-45-6789`, a UUID | **`customer_id` integer sequence 1,2,3…** — header says "id" but values are sequential ints → keep `OTHER`/`NONE`, *not* HIGH. **Headline FP guard.** |
| `CREDIT_CARD` (HIGH) | `4111 1111 1111 1111` (Luhn-valid) | `4111 1111 1111 1112` (fails Luhn); a 16-digit order number. **Luhn is the disambiguator** vs ID/phone. |
| `DATE_OF_BIRTH` (HIGH) | header `date_of_birth`, values `1985-04-12` | **`signup_date` / `created_at`** — DATE-typed but header lacks birth → `NONE`. Distinguishes DOB from ordinary dates. |
| `NAME` (MEDIUM) | header `full_name`, `Ada Lovelace` | `New York`, product titles — two-capitalized-words alone is weak → require header signal or high share, else `OTHER` |
| `ADDRESS` (MEDIUM) | `221B Baker St` | `Baker` alone; city `St. Louis` |
| `IP_ADDRESS` (MEDIUM) | `192.168.1.1` | `999.1.1.1` (octet >255); `1.2.3` (3 octets); version `1.2.3.4` risk → octet guard |
| `POSTAL_CODE` (LOW) | `94107`, `94107-1234` | year `2024` (4 digits); a 5-digit ID |
| `NONE` (NONE) | a numeric metric column resolved as not-sensitive | — counts as **classified** for coverage (§8) |
| `OTHER` (LOW) | free-text notes with a resolved-but-unfitting tag | — |

Assertions: `classifyColumn({ header, sampleValues })` → `{ category, sensitivity, confidence }`. For each category, one TP asserting `category` + `sensitivity`, one FP asserting it resolves to `NONE`/`OTHER` (or a different category). Confidence = match share; a threshold test: share 0.69 → not classified as that category, 0.71 → classified.

### 3.3 Type inference (`domain/profile.ts` → `inferColumnType`)

| Sample values | → `DataType` |
|---|---|
| `["1","2","3"]` | `INTEGER` |
| `["1.5","2.0"]` | `FLOAT` |
| `["true","false"]` | `BOOLEAN` |
| `["2024-01-01"]` | `DATE` |
| `["2024-01-01T10:00:00Z"]` | `DATETIME` |
| `["ada@x.io","bob"]` | `STRING` |
| `[]` / all-null | `UNKNOWN` |
| `["1","x","2"]` (mixed) | `STRING` (dominant-type fallback), `dominantTypeShare ≈ 0.67` tracked for Consistency |

### 3.4 Quality checks (`domain/quality.ts` → `detectQualityChecks`)

Emits `QualityCheck[]` with `checkType` + `severity` (§6). Proposed severity thresholds: `missingPct ≥ 0.5` → `ERROR`, `≥ 0.2` → `WARNING`, `> 0` → `INFO`.

| Profile condition | `checkType` | `severity` | scope |
|---|---|---|---|
| column `missingPct > 0` | `MISSING_VALUES` | by threshold | column |
| `duplicateRows > 0` | `DUPLICATE_ROWS` | WARNING | dataset (`columnId=null`) |
| `validity < 1` | `INVALID_VALUES` | WARNING | column |
| `dominantTypeShare < 1` | `TYPE_MISMATCH` | INFO/WARNING | column |
| `completeness == 0` (all null) | `EMPTY_COLUMN` | WARNING | column |
| two headers share a name | `DUPLICATE_HEADER` | ERROR | dataset |

---

## 4. Integration test (the middle)

**File:** `apps/api/tests/routes/datasets.integration.test.ts` — **Supertest** against the Express app (`createApp()` factory, no `listen()`), real `services/` and `domain/`, real Prisma.

**Flow:** `POST /api/datasets` with a small in-memory CSV buffer → assert the returned summary → `GET /api/datasets` shows it in the catalog → `GET /api/datasets/:id` exposes the classification.

**Fixture CSV** (4 rows, 4 cols; row 4 duplicates row 1 → `duplicateRows=1`, all values present & valid):

```
email,full_name,age,signup_date
ada@example.com,Ada Lovelace,36,2023-01-15
grace@example.com,Grace Hopper,45,2023-02-20
alan@example.com,Alan Turing,41,2023-03-10
ada@example.com,Ada Lovelace,36,2023-01-15
```

**Asserts:** `status='READY'`, `rowCount=4`, `columnCount=4`, `fileType='CSV'`; Completeness=Validity=1, Uniqueness=1−1/4=0.75 → **`qualityScore ≈ 92.5`**; catalog list contains `customers.csv`; `email` column → `dataType='STRING'`, tag `EMAIL`/`HIGH`; `signup_date` → `DATE` and **not** DOB (`NONE`). Second case: a `.pdf` upload → **400** `{ error: { code: 'UNSUPPORTED_FILE_TYPE' } }`.

**Test-DB strategy.** Prisma + Postgres (SPEC §4), so tests need a real Postgres — not a mock.

- **Provision:** a throwaway DB via local Docker `postgres:16` (or a Neon test **branch**). `DATABASE_URL` points at it (env override; never the dev/prod DB).
- **Schema:** `prisma migrate deploy` once in a Vitest `globalSetup` (and in CI, §7).
- **Isolation:** `TRUNCATE … RESTART IDENTITY CASCADE` in `beforeEach` — simplest reliable reset. (Per-test transaction-rollback is faster but awkward with Prisma's connection model; truncate wins for a take-home. `ponytail:` truncate is the low-effort correct choice; revisit only if the suite grows large.)
- **Teardown:** `prisma.$disconnect()` in `afterAll`.

---

## 5. Component tests (the thin top — RTL)

**Runner:** Vitest + React Testing Library + `@testing-library/user-event`, JSDOM. Network mocked at the boundary with **MSW** (component/hooks/`fetch` behave as in prod). Providers (`QueryClientProvider` with `retry:false`, router) wrapped via a shared `renderWithProviders`. Accessible queries only (`getByRole`/`getByText`), never `container.querySelector`.

**Test A — catalog renders rows.** MSW stubs `GET /api/datasets` → 2 datasets. Render `<CatalogPage/>` → `expect(await screen.findByText('customers.csv'))` present, both rows visible, the quality gauge/score for each rendered. Proves the dashboard binds catalog data (SPEC §3 area 7).

```tsx
test("catalog lists datasets from the API", async () => {
  server.use(http.get("/api/datasets", () => HttpResponse.json([
    { id: "1", name: "customers.csv", qualityScore: 95, trustScore: 97.75, valueScore: 92, valueRecommendation: "KEEP" },
    { id: "2", name: "events_log.csv", qualityScore: 88, trustScore: 90, valueScore: 92, valueRecommendation: "KEEP" },
  ])));
  renderWithProviders(<CatalogPage />);
  expect(await screen.findByText("customers.csv")).toBeInTheDocument();
  expect(screen.getByText("events_log.csv")).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
});
```

**Test B — "explain this score" popover expands.** Render `<ScoreBadge score={95} breakdown={{ completeness: 0.95, validity: 1, uniqueness: 0.9 }} />`. Trigger hidden initially; `await user.click(getByRole('button', { name: /explain/i }))` → the same sub-scores our scoring test asserts appear (SPEC §2.4, §9 transparency).

```tsx
test("explain-score popover reveals the SPEC §9 breakdown", async () => {
  const user = userEvent.setup();
  render(<ScoreBadge score={95} breakdown={{ completeness: 0.95, validity: 1, uniqueness: 0.9 }} />);
  expect(screen.queryByText(/completeness/i)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /explain/i }));
  expect(await screen.findByText(/completeness/i)).toBeInTheDocument();
  expect(screen.getByText(/0\.95/)).toBeInTheDocument();
});
```

---

## 6. Edge-case test matrix (defends the 15% bucket)

Each maps to a `samples/` file (SPEC §11) and the graceful-degradation rule (SPEC §2.3): **no input makes the demo look broken.**

| # | Edge case | Input | Expected behavior | Layer | Sample |
|---|---|---|---|---|---|
| 1 | **Empty file** | 0 bytes / header-only, 0 data rows | Ingest doesn't crash; `rowCount=0`; scores **null** (not NaN); `status=FAILED` or READY-with-null + an `EMPTY` note | domain + route | `broken.csv` |
| 2 | **Duplicate headers** | `id,name,name` | `DUPLICATE_HEADER` check (ERROR); columns disambiguated (`name`, `name_2`); Consistency penalized | domain | `broken.csv` |
| 3 | **Ragged rows** | rows with fewer/more cells than header | missing cells → null (counted in completeness); extra cells dropped/flagged; structural penalty on Consistency | domain (parser) | `messy_orders.csv` |
| 4 | **All-null column** | a column entirely blank | `EMPTY_COLUMN` (WARNING); `completeness=0`, `dataType=UNKNOWN`; **valid low score, not null** | domain | `messy_orders.csv` |
| 5 | **Oversized file (cap)** | file > `MAX_UPLOAD_BYTES` | rejected pre-parse (413) **or** stream-parsed with capped rows (SPEC §6 storage decision) — never OOM | route (multer limit) | synthetic |
| 6 | **Non-CSV/XLSX** | `.pdf` / `.exe` / wrong MIME | **400** `{ error: { code: 'UNSUPPORTED_FILE_TYPE' } }` | route | synthetic |
| 7 | **Mixed-type column** | `["1","x","2"]` | `dataType=STRING`, `dominantTypeShare` tracked, `TYPE_MISMATCH` check | domain | `messy_orders.csv` |
| 8 | **Duplicate rows** | identical data rows | `DUPLICATE_ROWS` (dataset-level); Uniqueness drops | domain | `messy_orders.csv` |

Cases 1–4, 7–8 are pure-domain (cheapest to test). 5–6 need a thin route test. The integration test (§4) already covers case 6.

---

## 7. Tooling, running, CI

**Stack (SPEC §4):** Vitest (runner + assertions + coverage) · Supertest (API) · React Testing Library + `user-event` + MSW (components). One toolchain, two Vitest projects (`node` env for `api`, `jsdom` for `web`).

```jsonc
// package.json scripts (root, pnpm workspaces)
"test":          "pnpm -r test",
"test:api":      "pnpm --filter @assay/api test",
"test:web":      "pnpm --filter @assay/web test",
"typecheck":     "pnpm -r typecheck"      // tsc --noEmit per package
```

**Run:**

```bash
pnpm test                 # everything
pnpm --filter @assay/api test domain/scoring       # just the scoring unit file (fast, no DB)
DATABASE_URL=postgres://…/assay_test pnpm test:api tests/routes   # integration (needs test DB)
pnpm test -- --coverage   # coverage (target: domain/ ≥ 90%)
```

Coverage focus: `domain/` ≥ 90% (pure, high-value); routes/services covered by the one integration test; web components behavior-covered, not line-chased.

**Lightweight GitHub Actions CI** — `typecheck + test on push` (SPEC §14 git hygiene), Postgres service for the integration test:

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: assay_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/assay_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 11 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @assay/api exec prisma migrate deploy
      - run: pnpm -r typecheck
      - run: pnpm -r test
```

---

## 8. Example file 1 — `apps/api/src/domain/scoring.test.ts` (full)

Co-located with `scoring.ts`. Written **first** (TDD): it defines the module's public API and asserts the SPEC §9 worked examples plus the empty-dataset edge.

```ts
import { describe, it, expect } from "vitest";
import {
  scoreQuality,
  scoreTrust,
  scoreValue,
  valueRecommendation,
  type DatasetProfile,
  type UsageProfile,
} from "./scoring";

// --- Fixtures -------------------------------------------------------------

// "clean-ish" 100-row, 4-col dataset — mirrors samples/customers.csv (SPEC §11).
// completeness_col = [1.0, 1.0, 0.9, 0.9] -> Completeness = 0.95
// validity_col     = [1, 1, 1, 1]         -> Validity     = 1.00
// duplicateRows    = 10 of 100            -> Uniqueness   = 0.90
// dominantTypeShare all 1.0, no structural issues -> Consistency = 1.00
// all 4 columns classified (incl. explicit NONE)  -> Coverage    = 1.00
const customers: DatasetProfile = {
  rowCount: 100,
  duplicateRows: 10,
  structuralPenalty: 1, // 1 = no duplicate/blank headers, no ragged rows
  columns: [
    { completeness: 1.0, validity: 1, dominantTypeShare: 1, classified: true },
    { completeness: 1.0, validity: 1, dominantTypeShare: 1, classified: true },
    { completeness: 0.9, validity: 1, dominantTypeShare: 1, classified: true },
    { completeness: 0.9, validity: 1, dominantTypeShare: 1, classified: true },
  ],
};

// --- Quality (SPEC §9: 0.40·Completeness + 0.30·Validity + 0.30·Uniqueness) --

describe("scoreQuality", () => {
  it("weights completeness/validity/uniqueness per SPEC §9", () => {
    const q = scoreQuality(customers)!;
    expect(q.completeness).toBeCloseTo(0.95, 4);
    expect(q.validity).toBeCloseTo(1.0, 4);
    expect(q.uniqueness).toBeCloseTo(0.9, 4);
    // 100 * (0.40*0.95 + 0.30*1.00 + 0.30*0.90) = 95.0
    expect(q.score).toBeCloseTo(95.0, 2);
  });

  it("returns null for an empty dataset (0 rows) instead of NaN", () => {
    const empty: DatasetProfile = { rowCount: 0, duplicateRows: 0, structuralPenalty: 1, columns: [] };
    expect(scoreQuality(empty)).toBeNull();
  });

  it("returns null for a header-only dataset (headers parsed, 0 data rows)", () => {
    const headerOnly: DatasetProfile = {
      rowCount: 0,
      duplicateRows: 0,
      structuralPenalty: 1,
      columns: [{ completeness: 0, validity: 0, dominantTypeShare: 0, classified: false }],
    };
    expect(scoreQuality(headerOnly)).toBeNull();
  });
});

// --- Trust (SPEC §9: 0.45·(Quality/100) + 0.30·Consistency + 0.25·Coverage) --

describe("scoreTrust", () => {
  it("derives Trust from Quality + Consistency + ClassificationCoverage", () => {
    const q = scoreQuality(customers)!;
    const t = scoreTrust(customers, q.score)!;
    expect(t.consistency).toBeCloseTo(1.0, 4);
    expect(t.classificationCoverage).toBeCloseTo(1.0, 4);
    // 100 * (0.45*(95/100) + 0.30*1.00 + 0.25*1.00) = 97.75
    expect(t.score).toBeCloseTo(97.75, 2);
  });

  it("is null when Quality is null (empty dataset)", () => {
    const empty: DatasetProfile = { rowCount: 0, duplicateRows: 0, structuralPenalty: 1, columns: [] };
    expect(scoreTrust(empty, null)).toBeNull();
  });

  it("penalizes Consistency for structural issues (ragged rows / dup headers)", () => {
    const t = scoreTrust({ ...customers, structuralPenalty: 0.8 }, 95.0)!;
    expect(t.consistency).toBeCloseTo(0.8, 4);
    // 100 * (0.45*0.95 + 0.30*0.80 + 0.25*1.00) = 91.75
    expect(t.score).toBeCloseTo(91.75, 2);
  });
});

// --- Value (SPEC §9: 0.45·Frequency + 0.35·Recency + 0.20·Trend) ------------

describe("scoreValue + valueRecommendation", () => {
  it("scores a hot dataset high and recommends KEEP", () => {
    const hot: UsageProfile = { accesses90d: 50, accessesLast30: 20, accessesPrev30: 15, daysSinceLastAccess: 1 };
    const v = scoreValue(hot);
    expect(v.frequency).toBeCloseTo(1.0, 4); // min(1, log1p(50)/log1p(50))
    expect(v.recency).toBeCloseTo(0.9672, 3); // exp(-1/30)
    expect(v.trend).toBeCloseTo(0.6667, 3); // 0.5 + (20-15)/(2*15)
    expect(v.score).toBeCloseTo(92.2, 1);
    expect(valueRecommendation(v.score, hot)).toBe("KEEP");
  });

  it("recommends RETIRE when never accessed, with a real score (not NaN)", () => {
    const dead: UsageProfile = { accesses90d: 0, accessesLast30: 0, accessesPrev30: 0, daysSinceLastAccess: null };
    const v = scoreValue(dead);
    expect(v.frequency).toBe(0);
    expect(v.recency).toBe(0); // null daysSinceLastAccess -> 0 (guard)
    expect(v.score).toBeCloseTo(10.0, 4); // 100 * (0 + 0 + 0.20*0.5)
    expect(valueRecommendation(v.score, dead)).toBe("RETIRE"); // 0 accesses in 90d
  });

  it("recommends ARCHIVE for a low-value declining dataset (15–35 band)", () => {
    const declining: UsageProfile = { accesses90d: 3, accessesLast30: 0, accessesPrev30: 3, daysSinceLastAccess: 45 };
    const v = scoreValue(declining);
    expect(v.trend).toBeLessThan(0.5); // declining
    expect(v.score).toBeCloseTo(23.7, 1);
    expect(valueRecommendation(v.score, declining)).toBe("ARCHIVE");
  });
});
```

---

## 9. Example file 2 — `apps/api/tests/routes/datasets.integration.test.ts` (full)

Supertest against the Express app; real services/domain/Prisma; throwaway test DB reset per test.

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";      // factory: builds Express app, no .listen()
import { prisma } from "../../src/lib/prisma";

// Small in-memory CSV: 4 data rows, 4 columns; row 4 duplicates row 1.
const CSV = [
  "email,full_name,age,signup_date",
  "ada@example.com,Ada Lovelace,36,2023-01-15",
  "grace@example.com,Grace Hopper,45,2023-02-20",
  "alan@example.com,Alan Turing,41,2023-03-10",
  "ada@example.com,Ada Lovelace,36,2023-01-15",
].join("\n");

const app = createApp();

beforeAll(async () => {
  // Schema is applied by globalSetup / CI via `prisma migrate deploy` on the test DATABASE_URL.
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // One statement resets every table; CASCADE handles FKs, RESTART IDENTITY resets sequences.
  await prisma.$executeRawUnsafe(
    'TRUNCATE "ClassificationTag","QualityCheck","AccessEvent","ScoreSnapshot","Column","Dataset" RESTART IDENTITY CASCADE',
  );
});

describe("POST /api/datasets -> GET /api/datasets", () => {
  it("ingests a CSV and reflects correct counts, scores, and PII tags in the catalog", async () => {
    // Upload
    const upload = await request(app)
      .post("/api/datasets")
      .attach("file", Buffer.from(CSV), "customers.csv")
      .expect(201);

    const ds = upload.body;
    expect(ds.status).toBe("READY");
    expect(ds.rowCount).toBe(4);
    expect(ds.columnCount).toBe(4);
    expect(ds.fileType).toBe("CSV");
    // Completeness=Validity=1.0, duplicateRows=1 -> Uniqueness=0.75
    // Quality = 100 * (0.40*1 + 0.30*1 + 0.30*0.75) = 92.5
    expect(ds.qualityScore).toBeCloseTo(92.5, 1);

    // Catalog list reflects it
    const list = await request(app).get("/api/datasets").expect(200);
    expect(list.body.map((d: { name: string }) => d.name)).toContain("customers.csv");

    // Detail exposes classification (SPEC §8): email -> EMAIL/HIGH
    const detail = await request(app).get(`/api/datasets/${ds.id}`).expect(200);
    const email = detail.body.columns.find((c: { name: string }) => c.name === "email");
    expect(email.dataType).toBe("STRING");
    expect(email.classificationTag.category).toBe("EMAIL");
    expect(email.classificationTag.sensitivity).toBe("HIGH");

    // signup_date is a DATE but NOT date-of-birth -> not flagged HIGH (false-positive guard)
    const date = detail.body.columns.find((c: { name: string }) => c.name === "signup_date");
    expect(date.dataType).toBe("DATE");
    expect(date.classificationTag?.category ?? "NONE").toBe("NONE");
  });

  it("rejects a non-CSV/XLSX upload with 400 and a typed error", async () => {
    const res = await request(app)
      .post("/api/datasets")
      .attach("file", Buffer.from("%PDF-1.7 fake"), "notes.pdf")
      .expect(400);
    expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });
});
```

---

## 10. Traceability — test → SPEC → rubric

| Test | SPEC anchor | Rubric bucket |
|---|---|---|
| `scoreQuality/Trust/Value` unit | §9 formulas, §6 nullable scores | Correctness 20% |
| classification TP/FP unit | §8 categories + threshold | Correctness 20% |
| type inference / quality checks unit | §6 enums, §9 inputs | Correctness 20% |
| upload → catalog integration | §7 routes, §5 layering, §3 ingestion | Correctness 20% + structure 15% |
| edge-case matrix | §2.3, §11 samples | Edge cases 15% |
| catalog + explain-score component | §3 area 7, §2.4, §9 transparency | Frontend UX 15% |
| CI typecheck + test on push | §14 | Git hygiene 10% |
