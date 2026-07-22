// All tunable constants in one place (00-SPEC §9): scoring weights (06 §3),
// classification constants (07 §0), and the upload cap. Weights per score sum to 1
// (asserted by the scoring engine's self-check in Phase 2).

/**
 * The shape of every scoring tunable. `config` below is the static default; the settings
 * service (R3) builds an *effective* config from persisted overrides and passes it into the
 * pure engines as their optional trailing parameter. The module-level `config` is never mutated.
 */
export interface ScoringConfig {
  readonly quality: { readonly completeness: number; readonly validity: number; readonly uniqueness: number };
  readonly trust: { readonly quality: number; readonly consistency: number; readonly classificationCoverage: number };
  readonly value: { readonly frequency: number; readonly recency: number; readonly trend: number };
  readonly classifyThreshold: number;
  readonly freqCap: number;
  readonly halfLifeDays: number;
  readonly trendBaselineMin: number;
  readonly recencyMinAccesses: number;
  readonly structuralPenaltyPerIssue: number;
  readonly structuralPenaltyCap: number;
  readonly recommend: { readonly retireBelow: number; readonly archiveBelow: number; readonly optimizeBelow: number };
}

export const config = {
  // --- score weight sets (00-SPEC §9) ---
  quality: { completeness: 0.40, validity: 0.30, uniqueness: 0.30 },
  trust: { quality: 0.45, consistency: 0.30, classificationCoverage: 0.25 },
  value: { frequency: 0.45, recency: 0.35, trend: 0.20 },

  // --- named constants (00-SPEC §8, §9) ---
  classifyThreshold: 0.70, // CLASSIFY_THRESHOLD — value-pattern match share to auto-classify
  freqCap: 50, // FREQ_CAP — accesses at which Frequency saturates to 1
  halfLifeDays: 30, // HALFLIFE — Recency decay half-life (days)

  // Two guards that stop a SINGLE access from reading as a thriving dataset. Without them
  // Recency and Trend both saturate to 1.0 on the first view, which is 55% of the Value
  // weight — so one click moved a dataset from RETIRE straight to KEEP and the ARCHIVE /
  // OPTIMIZE bands were unreachable for anything a reviewer actually opened. That defeats
  // the brief's "identify datasets with low or no activity".
  trendBaselineMin: 5, // a growth ratio needs a real prior period, not a denominator of 1
  recencyMinAccesses: 3, // "used recently" needs more evidence than one hit to count fully

  // --- structural penalty: pins §9's "penalized by structural issues" (06 §5) ---
  structuralPenaltyPerIssue: 0.05, // per distinct defect type
  structuralPenaltyCap: 0.20, // max total penalty

  // --- Value → recommendation thresholds (00-SPEC §9 table) ---
  recommend: { retireBelow: 15, archiveBelow: 35, optimizeBelow: 60 },
} as const satisfies ScoringConfig;

// Classification tuning (07 §0). `CLASSIFY_THRESHOLD` mirrors config.classifyThreshold
// (spec-pinned); the rest are implementation fill-ins the spec leaves open.
export const CLASSIFY = {
  CLASSIFY_THRESHOLD: 0.70, // [spec §8] value-match share to auto-classify; confidence = share
  SAMPLE_SIZE: 200, // [tunable] non-null values reservoir-sampled per column for value matching
  AI_SAMPLE_SIZE: 10, // [tunable] values sent to the LLM (reuse Column.sampleValues, ≤10)
  HEADER_CONFIDENCE: 0.60, // [tunable] confidence when only the header name matches
  AMBIGUOUS_MIN: 0.30, // [tunable] partial value-share (0.30–0.70) that marks a column "ambiguous"
} as const;

// Ingestion caps (00-SPEC §6 / 03 §6) — what a dataset persists beyond its profile.
// Structural, not tunable at runtime: they bound stored PII, so GET /api/system reports
// them read-only rather than exposing them as settings.
export const INGEST = {
  sampleRowsCap: 50, // preview rows persisted per dataset
  sampleValuesCap: 10, // distinct example values persisted per column
} as const;

// Upload cap (04 §2.2), enforced via multer `limits.fileSize`.
// Env-tunable via `MAX_UPLOAD_MB` so a constrained host (e.g. a 512 MB free-tier
// dyno) can lower it without a code change, and so tests can pin it small rather
// than allocating a production-sized buffer. Default 100 MB.
const parsedUploadMb = Number(process.env.MAX_UPLOAD_MB);
export const MAX_UPLOAD_MB =
  Number.isFinite(parsedUploadMb) && parsedUploadMb > 0 ? parsedUploadMb : 100;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
