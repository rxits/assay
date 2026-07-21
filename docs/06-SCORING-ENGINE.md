# 06 — Scoring Engine (assay)

> Purpose: the exact, defensible math + domain model behind Quality, Trust, and Value. **Derived from 00-SPEC.md** (formulas/weights/constants: §9; Trust-vs-Value: §15; field names: §6). Formulas are copied verbatim from the spec and *elaborated*, never changed.

---

## 1. The three scores and the distinction the exercise is testing

Three numbers, each answering a different question. All inputs normalize to `[0,1]`; all scores report `0–100` (00-SPEC §9).

| Score | Question | Depends on | Independent of |
|---|---|---|---|
| **Quality** | "How clean is the data *in the file*?" | completeness, validity, uniqueness | usage |
| **Trust** | "How *reliable* is this data to rely on?" | **Quality** ⊕ consistency ⊕ classification coverage | usage |
| **Value** | "How much is this data actually *used / worth*?" | access frequency, recency, trend | **quality entirely** |

The two relationships that the brief is probing (00-SPEC §9, §15):

- **Trust ⊇ Quality.** Trust *contains* Quality as its heaviest term (weight 0.45) and then adds reliability signals quality alone can't see (are types consistent? is every sensitive column actually classified?). A dataset can be clean yet untrustworthy — e.g. pristine values but half its PII columns unclassified.
- **Value ⟂ Quality.** Value is computed from access events only. A filthy dataset everyone hammers daily is high-Value; a flawless dataset nobody has opened in 90 days is low-Value → `RETIRE`. Worth and cleanliness are orthogonal.

**We encode both facts in the function types themselves** (§9 below), so they're impossible to violate:

```ts
computeTrust(quality: QualityResult, profile: DatasetProfile): TrustResult  // ⊇ : cannot compute Trust without a Quality
computeValue(events: AccessEvent[], now: Date): ValueResult                 // ⟂ : literally cannot see the profile
```

`computeTrust` can't be called without a `QualityResult` in hand; `computeValue`'s signature has no access to any quality/profile input at all. The domain model makes the wrong dependency graph unrepresentable.

---

## 2. Domain model (precise types, illegal states unrepresentable)

Two modeling moves keep the engine honest.

**(a) A branded `Unit` for every normalized `[0,1]` scalar.** The one bug this domain invites is mixing a `0–1` fraction with a `0–100` score. Branding makes that a compile error, and the smart constructor is also the single choke point that kills `NaN`/out-of-range (every edge case in §8 funnels through it).

```ts
/** A scalar guaranteed to lie in [0,1]. Constructed only via unit(). */
export type Unit = number & { readonly __unit: unique symbol };

/** Smart constructor: clamps to [0,1] and maps NaN → 0. No Unit can be illegal. */
export const unit = (n: number): Unit =>
  (Number.isNaN(n) ? 0 : Math.max(0, Math.min(1, n))) as Unit;

/** A reported score, 0–100. Full precision internally; rounded only at the UI/JSON edge. */
export type Score = number;
```

`clamp01(x)` in the spec's Trend formula *is* `unit(x)` — same operation, reused.

**(b) One shape for a weighted term — the atom of "explain this score."** Every score is a sum of these, and the invariant `contribution === 100 * weight * value` is what the UI renders as a stacked bar.

```ts
export interface ScoreComponent {
  value: Unit;          // the normalized input, [0,1]
  weight: number;       // from config; a score's weights sum to 1
  contribution: number; // INVARIANT: 100 * weight * value  (the points this term adds)
}
```

### Inputs (produced by the profiling domain, 00-SPEC §6 fields)

```ts
export type DataType =
  | 'STRING' | 'INTEGER' | 'FLOAT' | 'BOOLEAN' | 'DATE' | 'DATETIME' | 'UNKNOWN';

export interface ColumnProfile {
  name: string;
  position: number;            // 0-based ordinal
  dataType: DataType;
  rowCount: number;            // = dataset row count (the completeness denominator)
  nonNullCount: number;        // 0..rowCount
  typeMatchCount: number;      // 0..nonNullCount — values matching the inferred type
  dominantTypeShare: number;   // 0..1 — share matching the single most common inferred type
  distinctCount: number;
  isClassified: boolean;       // has a resolved tag, INCLUDING explicit NONE (§8 of spec)
}

export type StructuralIssueType = 'DUPLICATE_HEADER' | 'BLANK_HEADER' | 'RAGGED_ROWS';

export interface DatasetProfile {
  rowCount: number;            // 0 allowed (empty file)
  duplicateRowCount: number;   // 0..rowCount
  columns: ColumnProfile[];    // [] allowed (fully-empty file)
  structuralIssues: StructuralIssueType[]; // distinct defect types detected
}

/** Value's ONLY input beyond `now`. Just the timestamps — see note in §6. */
export interface AccessEvent { occurredAt: Date; }
```

### Outputs (also the persisted `scoreBreakdown`, spec §6)

```ts
export type ValueRecommendation = 'KEEP' | 'OPTIMIZE' | 'ARCHIVE' | 'RETIRE';

export interface QualityResult {
  score: Score;
  components: { completeness: ScoreComponent; validity: ScoreComponent; uniqueness: ScoreComponent };
}

export interface TrustResult {
  score: Score;
  components: { quality: ScoreComponent; consistency: ScoreComponent; classificationCoverage: ScoreComponent };
  consistencyDetail: {
    meanDominantTypeShare: Unit;
    structuralPenalty: Unit;
    structuralIssues: StructuralIssueType[];
  };
}

export interface ValueResult {
  score: Score;
  recommendation: ValueRecommendation;
  components: { frequency: ScoreComponent; recency: ScoreComponent; trend: ScoreComponent };
  inputs: {
    accesses90d: number;
    accessesLast30: number;
    accessesPrev30: number;
    daysSinceLastAccess: number | null; // null = never accessed (Recency = 0)
    isDeclining: boolean;               // trend < 0.5
  };
}

/** Stored verbatim in Dataset.scoreBreakdown (Json?) — powers "explain this score". */
export interface ScoreBreakdown {
  quality: QualityResult;
  trust: TrustResult;
  value: ValueResult;
}
```

The three scalar columns (`Dataset.qualityScore/trustScore/valueScore`, spec §6) hold the rounded `score`; `scoreBreakdown` holds the full decomposition. One shape, stored and returned — no second DTO to drift.

---

## 3. The single `config` object (one place to tune)

Every constant in the engine lives here. Weights per score sum to `1` (asserted in §10's self-check).

```ts
export const config = {
  // --- score weight sets (00-SPEC §9) ---
  quality: { completeness: 0.40, validity: 0.30, uniqueness: 0.30 },
  trust:   { quality: 0.45, consistency: 0.30, classificationCoverage: 0.25 },
  value:   { frequency: 0.45, recency: 0.35, trend: 0.20 },

  // --- named constants (00-SPEC §8, §9) ---
  classifyThreshold: 0.70,   // CLASSIFY_THRESHOLD — value-pattern match share to auto-classify
  freqCap: 50,               // FREQ_CAP  — accesses at which Frequency saturates to 1
  halfLifeDays: 30,          // HALFLIFE  — Recency decay half-life (days)

  // --- structural penalty: pins §9's "penalized by structural issues" (see §5) ---
  structuralPenaltyPerIssue: 0.05, // per distinct defect type
  structuralPenaltyCap: 0.20,      // max total penalty

  // --- Value → recommendation thresholds (00-SPEC §9 table) ---
  recommend: { retireBelow: 15, archiveBelow: 35, optimizeBelow: 60 },
} as const;
```

`classifyThreshold` is consumed by the classification domain, not the scorers, but lives here so "all constants, one file" holds literally.

---

## 4. Quality

**Question:** how clean is the data in the file? **Independent of usage.**

### Inputs (00-SPEC §9)
Per column: `completeness_col = nonNull / rowCount`, `validity_col = matchesInferredType / nonNull`.
Dataset level:
- `Completeness = mean(completeness_col)`
- `Validity = mean(validity_col)` *(accuracy proxy)*
- `Uniqueness = 1 − duplicateRows / rowCount`

### Formula (verbatim, 00-SPEC §9)
```
Quality = 100 × (0.40·Completeness + 0.30·Validity + 0.30·Uniqueness)
```

### Worked example — `customers.csv` (100 rows, 4 cols, 3 duplicate rows)

| col | nonNull | completeness_col | typeMatch | validity_col |
|---|---|---|---|---|
| c1 | 100 | 1.0000 | 100 | 1.0000 |
| c2 |  90 | 0.9000 |  88 | 0.9778 |
| c3 | 100 | 1.0000 | 100 | 1.0000 |
| c4 |  96 | 0.9600 |  90 | 0.9375 |

```
Completeness = (1.0000 + 0.9000 + 1.0000 + 0.9600) / 4 = 3.8600 / 4 = 0.9650
Validity     = (1.0000 + 0.9778 + 1.0000 + 0.9375) / 4 = 3.9153 / 4 = 0.97882
Uniqueness   = 1 − 3/100 = 0.9700

Quality = 100 × (0.40·0.9650 + 0.30·0.97882 + 0.30·0.9700)
        = 100 × (0.38600 + 0.293646 + 0.29100)
        = 100 × 0.970646
        = 97.06
```

### Stored `scoreBreakdown.quality`
`contribution = 100 × weight × value`; contributions sum to `score`.

```json
{
  "score": 97.06,
  "components": {
    "completeness": { "value": 0.9650,  "weight": 0.40, "contribution": 38.60 },
    "validity":     { "value": 0.97882, "weight": 0.30, "contribution": 29.36 },
    "uniqueness":   { "value": 0.9700,  "weight": 0.30, "contribution": 29.10 }
  }
}
```

---

## 5. Trust

**Question:** how reliable is this data? **Trust ⊇ Quality** (00-SPEC §15). Still independent of usage.

### Inputs (00-SPEC §9)
- `Quality / 100` — the whole Quality score, normalized, as the 0.45 term (this is the ⊇).
- `Consistency = mean(dominantTypeShare_col)` *penalized by structural issues*.
- `ClassificationCoverage = classifiedColumns / columnCount` (a column with any resolved tag, **including explicit `NONE`**, counts — spec §8).

**Consistency penalty — pinning §9's "penalized by structural issues".** The spec names the penalty but not its magnitude; we define it precisely so the number is reproducible (constants in `config`, §3). Multiplicative, linear in the count of *distinct* structural defect types (duplicate headers, blank headers, ragged rows — spec §6 `QualityCheckType`), capped:

```
structuralPenalty = min(structuralPenaltyCap, structuralPenaltyPerIssue × |structuralIssues|)
Consistency       = mean(dominantTypeShare_col) × (1 − structuralPenalty)
```

This is an *elaboration of an under-specified constant, not a divergence* — the formula shape (`mean … penalized by structural issues`) is exactly §9.

### Formula (verbatim, 00-SPEC §9)
```
Trust = 100 × (0.45·(Quality/100) + 0.30·Consistency + 0.25·ClassificationCoverage)
```

### Worked example — same `customers.csv` (Quality = 97.06)

`dominantTypeShare_col` = [1.00, 0.98, 1.00, 0.95] → mean = 3.93/4 = **0.9825**.
Structural issues: none → `structuralPenalty = 0` → `Consistency = 0.9825 × 1 = 0.9825`.
Classification: 3 of 4 columns have a resolved tag → `ClassificationCoverage = 3/4 = 0.7500`.

```
Trust = 100 × (0.45·0.970646 + 0.30·0.9825 + 0.25·0.7500)
      = 100 × (0.436791 + 0.294750 + 0.187500)
      = 100 × 0.919041
      = 91.90
```

**Teaching point:** Quality 97.06 but Trust **91.90** — Trust *contains* Quality (43.68 of its points come straight from it) yet lands lower, dragged by incomplete classification coverage (0.75). Clean data, not fully trustworthy. Exactly the ⊇ distinction.

### Stored `scoreBreakdown.trust`

```json
{
  "score": 91.90,
  "components": {
    "quality":                { "value": 0.970646, "weight": 0.45, "contribution": 43.68 },
    "consistency":            { "value": 0.9825,   "weight": 0.30, "contribution": 29.48 },
    "classificationCoverage": { "value": 0.7500,   "weight": 0.25, "contribution": 18.75 }
  },
  "consistencyDetail": {
    "meanDominantTypeShare": 0.9825,
    "structuralPenalty": 0.0,
    "structuralIssues": []
  }
}
```

> Rounding note (applies to every breakdown): contributions are shown at 2 dp, but `score` is computed from full-precision values. Displayed parts may differ from their sum by ≤0.02 (here 43.68+29.48+18.75 = 91.91 vs score 91.90). Assertions use `toBeCloseTo`.

---

## 6. Value

**Question:** how much is this data used / worth? **Value ⟂ Quality** (00-SPEC §15) — computed from `AccessEvent`s (spec §6) and `now` only.

### Inputs (00-SPEC §9), with windows pinned
Let `now` be injected (never `Date.now()` inside — keeps the function pure/testable).

```
accesses90d        = |events in (now−90d, now]|
accessesLast30     = |events in (now−30d, now]|
accessesPrev30     = |events in (now−60d, now−30d]|
daysSinceLastAccess= max(0, (now − maxOccurredAt) / 1 day)   // null/∞ if no events → Recency 0
                     // max(0, …) guards clock-skew / future-dated seed events
```

All `AccessType`s (`VIEW`/`DETAIL_VIEW`/`DOWNLOAD`, spec §6) count equally — §9 says "accesses", unweighted. *ponytail: if download-weighting is ever wanted, it's a one-line change in the counting step, nowhere else.*

### Formula (verbatim, 00-SPEC §9)
```
Frequency = min(1, log1p(accesses90d) / log1p(FREQ_CAP))         FREQ_CAP = 50
Recency   = exp(−daysSinceLastAccess / HALFLIFE)                 HALFLIFE = 30
Trend     = clamp01(0.5 + (accessesLast30 − accessesPrev30) / (2·max(1, accessesPrev30)))
Value     = 100 × (0.45·Frequency + 0.35·Recency + 0.20·Trend)
```

### Worked example — a "cooling" dataset
`accesses90d = 8`, `daysSinceLastAccess = 24`, `accessesLast30 = 1`, `accessesPrev30 = 5`.

```
Frequency = log1p(8)/log1p(50) = ln(9)/ln(51)  = 2.197225/3.931826 = 0.558829
Recency   = exp(−24/30) = exp(−0.8)                                = 0.449329
Trend     = clamp01(0.5 + (1 − 5)/(2·max(1,5)))
          = clamp01(0.5 + (−4)/10) = clamp01(0.1)                  = 0.100000

Value = 100 × (0.45·0.558829 + 0.35·0.449329 + 0.20·0.100000)
      = 100 × (0.251473 + 0.157265 + 0.020000)
      = 100 × 0.428738
      = 42.87   → OPTIMIZE   (35–60 band; trend is declining but Value ≥ 35, so not ARCHIVE)
```

### Stored `scoreBreakdown.value`

```json
{
  "score": 42.87,
  "recommendation": "OPTIMIZE",
  "components": {
    "frequency": { "value": 0.558829, "weight": 0.45, "contribution": 25.15 },
    "recency":   { "value": 0.449329, "weight": 0.35, "contribution": 15.73 },
    "trend":     { "value": 0.100000, "weight": 0.20, "contribution": 2.00 }
  },
  "inputs": {
    "accesses90d": 8, "accessesLast30": 1, "accessesPrev30": 5,
    "daysSinceLastAccess": 24, "isDeclining": true
  }
}
```

---

## 7. Value → recommendation (decision table)

### The rule (00-SPEC §9), made total
The spec table is evaluated **top-down, first match wins**. `isDeclining ≡ Trend < 0.5` (i.e. `accessesLast30 < accessesPrev30`).

```ts
function recommend(score: Score, accesses90d: number, trend: Unit): ValueRecommendation {
  const { retireBelow, archiveBelow, optimizeBelow } = config.recommend; // 15 / 35 / 60
  const isDeclining = trend < 0.5;
  if (accesses90d === 0 || score < retireBelow)   return 'RETIRE';   // dead / near-dead
  if (score < archiveBelow && isDeclining)         return 'ARCHIVE';  // low AND fading
  if (score < optimizeBelow)                       return 'OPTIMIZE'; // mid, or low-but-not-fading
  return 'KEEP';                                                      // score ≥ 60
}
```

**Residual-band elaboration (not a divergence).** The spec table names ARCHIVE only for `15–35 AND declining`, leaving `[15,35)` *non-declining* unlabeled. Top-down evaluation routes it to **OPTIMIZE**: a low-value dataset that is *stable or growing* is a candidate to invest in, not to let go cold. The table's four outcomes and their thresholds are unchanged; we only fixed the evaluation order and the residual.

### Bands (half-open, unambiguous)
| Value | trend | → |
|---|---|---|
| `accesses90d = 0`, or `< 15` | any | `RETIRE` |
| `[15, 35)` | declining (`<0.5`) | `ARCHIVE` |
| `[15, 35)` | flat/rising (`≥0.5`) | `OPTIMIZE` |
| `[35, 60)` | any | `OPTIMIZE` |
| `≥ 60` | any | `KEEP` |

### Worked example rows (each fully computed)
| Scenario | 90d | last | L30 | P30 | Freq | Rec | Trend | **Value** | **Rec** |
|---|---|---|---|---|---|---|---|---|---|
| hot | 40 | 2d | 20 | 12 | 0.9445 | 0.9355 | 0.8333 | **91.91** | `KEEP` |
| cooling | 8 | 24d | 1 | 5 | 0.5588 | 0.4493 | 0.1000 | **42.87** | `OPTIMIZE` |
| fading | 4 | 40d | 0 | 3 | 0.4094 | 0.2636 | 0.0000 | **27.65** | `ARCHIVE` |
| dead | 0 | — | 0 | 0 | 0.0000 | 0.0000 | 0.5000 | **10.00** | `RETIRE` |

`dead` check: `accesses90d = 0` → `RETIRE` by rule 1 (and Value 10.00 < 15 agrees). Trend = `clamp01(0.5 + 0/(2·max(1,0)))` = `0.5` — the `max(1, …)` guard is what stops the 0/0.

---

## 8. Edge cases (every one has a defined, NaN-free return)

The `unit()` constructor (NaN→0, clamp) plus the guards below make every function **total**. Column-level rules: when `nonNullCount = 0`, emptiness is already penalized once via `completeness_col = 0`, so we do **not** double-penalize — `validity_col := 1` and `dominantTypeShare := 1` (vacuously: no present value is invalid or type-conflicting).

| Case | Quality | Trust | Value | Notes |
|---|---|---|---|---|
| **Empty dataset (0 rows)** | `0` | `0` | usage-only (may be >0) | `Completeness/Validity/Uniqueness := 0` when `rowCount = 0`. Service marks `status = FAILED`, leaves score columns `null` (spec §6); the pure fn still returns a defined `0`. |
| **No columns (0 cols)** | `0` | `0` | usage-only | Means over `[]` → `0`; `ClassificationCoverage := 0` (0/0 guarded). Also a `FAILED` file in practice. |
| **Single row** | normal | normal | usage-only | No special-casing: denominators ≥ 1. `Uniqueness = 1 − 0/1 = 1`. Numbers are coarse (each column 0 or 1 complete) but valid. |
| **Fully-missing column** | drags Completeness (its `completeness_col = 0`) | inherits via Quality; `dominantTypeShare := 1` | — | `validity_col := 1` (no values to be invalid). Surfaced as an `EMPTY_COLUMN` QualityCheck so the signal isn't lost. |
| **0 access events** | — | — | `Frequency=0, Recency=0, Trend=0.5` → **Value = 10.00**, `RETIRE` | `daysSinceLastAccess = null` ⇒ `Recency = exp(−∞) = 0`. |
| **Brand-new dataset** | scored normally from its profile | normal | depends on events | If **never opened**: 0 events → Value 10 → `RETIRE` (correct-by-construction: no demonstrated worth). If **opened once today** (the `DETAIL_VIEW` from `GET /datasets/:id`, spec §7): `90d=1,last=0d,L30=1,P30=0` → Freq 0.1763, Rec 1.0, Trend 1.0 → **Value 62.93 → KEEP**. |

**On brand-new → `RETIRE`:** this is intended, not a bug. Value = *demonstrated* usage; a dataset with zero events genuinely has none. The spec's own mechanics keep the demo sensible: `seed.ts` backdates events (§10) and every detail view records one (§7), so real datasets carry events and the harsh zero-case fires only for genuinely dead data — precisely the `RETIRE` candidate the exercise wants. We deliberately do **not** add a grace period (that *would* diverge from §9).

---

## 9. Pure-function API (`apps/api/src/domain`)

The real, unit-tested surface. No I/O, no DB, no `Date.now()` — `now` is injected. The signatures encode the spec's dependency graph (§1).

```ts
// domain/scoring.ts
export function computeQuality(profile: DatasetProfile): QualityResult;

// Trust ⊇ Quality: cannot be called without a QualityResult.
export function computeTrust(quality: QualityResult, profile: DatasetProfile): TrustResult;

// Value ⟂ Quality: signature has no profile/quality input, only events + clock.
export function computeValue(events: AccessEvent[], now: Date): ValueResult;

// Applied inside computeValue; exported for direct testing of the §7 table.
export function recommend(score: Score, accesses90d: number, trend: Unit): ValueRecommendation;

// The orchestration seam the ingestion service calls (services/, not domain/):
export function scoreDataset(
  profile: DatasetProfile,
  events: AccessEvent[],
  now: Date,
): { quality: QualityResult; trust: TrustResult; value: ValueResult; breakdown: ScoreBreakdown };
```

Internal helpers (small, pure, private): `mean(xs)`, `unit(n)`, `component(value, weight)` → `ScoreComponent`, and the window counters for Value. `component()` centralizes the `contribution = 100·weight·value` invariant so no call site can compute it inconsistently.

---

## 10. Testability

**Why these are pure functions.** No file/DB/network, no ambient clock, no mutation of inputs. Output depends only on arguments ⇒ deterministic ⇒ every worked example above is already a test fixture. This is why scoring lives in `domain/` (spec §5's `domain → services → routes` split): the judgment-bearing logic is the primary unit-test target, tested without spinning up Express, Prisma, or a DB.

**Worked examples → assertions.** Each numeric example transcribes directly:

```ts
import { describe, it, expect } from 'vitest';
import { computeQuality, computeTrust, computeValue, recommend, unit, config } from './scoring';

describe('scoring engine (00-SPEC §9)', () => {
  it('Quality — customers.csv', () => {
    expect(computeQuality(customersProfile).score).toBeCloseTo(97.06, 2);
  });

  it('Trust ⊇ Quality — lands below pure quality via coverage', () => {
    const q = computeQuality(customersProfile);
    const t = computeTrust(q, customersProfile);
    expect(t.score).toBeCloseTo(91.90, 2);
    expect(t.score).toBeLessThan(q.score); // the ⊇ relationship, asserted
  });

  it('Value — cooling dataset → OPTIMIZE', () => {
    const r = computeValue(coolingEvents, NOW);
    expect(r.score).toBeCloseTo(42.87, 2);
    expect(r.recommendation).toBe('OPTIMIZE');
  });

  // §7 decision table, driven directly
  it.each([
    { score: 91.91, a90: 40, trend: 0.83 as Unit, rec: 'KEEP' },
    { score: 42.87, a90:  8, trend: 0.10 as Unit, rec: 'OPTIMIZE' },
    { score: 27.65, a90:  4, trend: 0.00 as Unit, rec: 'ARCHIVE' },
    { score: 10.00, a90:  0, trend: 0.50 as Unit, rec: 'RETIRE' },
  ])('recommend($score, $a90) → $rec', ({ score, a90, trend, rec }) =>
    expect(recommend(score, a90, trend)).toBe(rec));

  // edge cases: total, never NaN
  it('empty dataset → 0, no NaN', () => {
    const q = computeQuality({ rowCount: 0, duplicateRowCount: 0, columns: [], structuralIssues: [] });
    expect(q.score).toBe(0);
    expect(Number.isNaN(q.score)).toBe(false);
  });
  it('0 access events → Value 10, RETIRE', () => {
    const r = computeValue([], NOW);
    expect(r.score).toBeCloseTo(10.0, 2);
    expect(r.recommendation).toBe('RETIRE');
  });
});

// config self-check (ponytail: one runnable guard on the load-bearing invariant)
it('weight sets each sum to 1', () => {
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  for (const w of [config.quality, config.trust, config.value])
    expect(sum(w)).toBeCloseTo(1, 10);
});
```

`toBeCloseTo(x, 2)` because scores are stored/compared at full precision and only *displayed* rounded — never assert on rounded internals. `now` is a parameter, so Recency/Trend are tested against a frozen `NOW` with zero flakiness.
