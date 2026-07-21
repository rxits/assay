// All tunable constants in one place (00-SPEC §9): scoring weights (06 §3),
// classification constants (07 §0), and the upload cap. Weights per score sum to 1
// (asserted by the scoring engine's self-check in Phase 2).

export const config = {
  // --- score weight sets (00-SPEC §9) ---
  quality: { completeness: 0.40, validity: 0.30, uniqueness: 0.30 },
  trust: { quality: 0.45, consistency: 0.30, classificationCoverage: 0.25 },
  value: { frequency: 0.45, recency: 0.35, trend: 0.20 },

  // --- named constants (00-SPEC §8, §9) ---
  classifyThreshold: 0.70, // CLASSIFY_THRESHOLD — value-pattern match share to auto-classify
  freqCap: 50, // FREQ_CAP — accesses at which Frequency saturates to 1
  halfLifeDays: 30, // HALFLIFE — Recency decay half-life (days)

  // --- structural penalty: pins §9's "penalized by structural issues" (06 §5) ---
  structuralPenaltyPerIssue: 0.05, // per distinct defect type
  structuralPenaltyCap: 0.20, // max total penalty

  // --- Value → recommendation thresholds (00-SPEC §9 table) ---
  recommend: { retireBelow: 15, archiveBelow: 35, optimizeBelow: 60 },
} as const;

// Classification tuning (07 §0). `CLASSIFY_THRESHOLD` mirrors config.classifyThreshold
// (spec-pinned); the rest are implementation fill-ins the spec leaves open.
export const CLASSIFY = {
  CLASSIFY_THRESHOLD: 0.70, // [spec §8] value-match share to auto-classify; confidence = share
  SAMPLE_SIZE: 200, // [tunable] non-null values reservoir-sampled per column for value matching
  AI_SAMPLE_SIZE: 10, // [tunable] values sent to Claude (reuse Column.sampleValues, ≤10)
  HEADER_CONFIDENCE: 0.60, // [tunable] confidence when only the header name matches
  AMBIGUOUS_MIN: 0.30, // [tunable] partial value-share (0.30–0.70) that marks a column "ambiguous"
} as const;

// Upload cap (04 §2.2): 10 MiB, enforced via multer `limits.fileSize` (Phase 1).
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
