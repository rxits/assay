// Pure Quality / Trust / Value scoring engine (06 §9, 00-SPEC §9). No I/O, no
// Date.now() — `now` is injected, so every worked example is a deterministic test.
// The signatures encode the spec's dependency graph (06 §1): computeTrust cannot
// be called without a QualityResult (Trust ⊇ Quality); computeValue has no access
// to any profile/quality input at all (Value ⟂ Quality).
import type { DataType, ValueRecommendation } from "@assay/shared";

// All tunable constants live in one file (06 §3); re-exported so callers/tests
// import `config` from the engine per 06 §10.
import { config, type ScoringConfig } from "../lib/config";
export { config };
export type { ScoringConfig };

// --- Branded [0,1] scalar (06 §2a) ---------------------------------------
/** A scalar guaranteed to lie in [0,1]. Constructed only via unit(). */
export type Unit = number & { readonly __unit: unique symbol };

/** Smart constructor: clamps to [0,1] and maps NaN → 0. No Unit can be illegal. */
export const unit = (n: number): Unit => (Number.isNaN(n) ? 0 : Math.max(0, Math.min(1, n))) as Unit;

/** A reported score, 0–100. Full precision internally; rounded only at the UI/JSON edge. */
export type Score = number;

/** The atom of "explain this score": INVARIANT contribution === 100 * weight * value. */
export interface ScoreComponent {
  value: Unit;
  weight: number;
  contribution: number;
}

// --- Inputs (produced by profiling + classification, 06 §2) --------------
export type StructuralIssueType = "DUPLICATE_HEADER" | "BLANK_HEADER" | "RAGGED_ROWS";

export interface ColumnProfile {
  name: string;
  position: number;
  dataType: DataType;
  rowCount: number; // = dataset row count (completeness denominator)
  nonNullCount: number; // 0..rowCount
  typeMatchCount: number; // 0..nonNullCount — values matching the inferred type
  dominantTypeShare: number; // 0..1 — share matching the single most common type
  distinctCount: number;
  isClassified: boolean; // has a resolved tag, INCLUDING explicit NONE (00-SPEC §8)
}

export interface DatasetProfile {
  rowCount: number; // 0 allowed (empty file)
  duplicateRowCount: number; // 0..rowCount
  columns: ColumnProfile[]; // [] allowed (fully-empty file)
  structuralIssues: readonly StructuralIssueType[]; // distinct defect types detected
}

/** Value's ONLY input beyond `now` — just the timestamps (06 §6). */
export interface AccessEvent {
  occurredAt: Date;
}

// --- Outputs (also the persisted scoreBreakdown, 00-SPEC §6) --------------
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
    isDeclining: boolean; // trend < 0.5
  };
}

export interface ScoreBreakdown {
  quality: QualityResult;
  trust: TrustResult;
  value: ValueResult;
}

// --- Private helpers ------------------------------------------------------
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Centralizes the contribution = 100·weight·value invariant so no call site drifts. */
const component = (value: Unit, weight: number): ScoreComponent => ({ value, weight, contribution: 100 * weight * value });

const scoreOf = (comps: ScoreComponent[]): Score => comps.reduce((s, c) => s + c.contribution, 0);

const DAY_MS = 86_400_000;

// --- Quality (06 §4) ------------------------------------------------------
/**
 * Weight the three already-derived Quality inputs. Split out of computeQuality so the
 * settings recompute (R3) can re-weight a *stored* breakdown — whose component values are
 * properties of the data, not of the weights — without re-reading the original file.
 */
export function qualityFromComponents(
  inputs: { completeness: Unit; validity: Unit; uniqueness: Unit },
  cfg: ScoringConfig = config,
): QualityResult {
  const w = cfg.quality;
  const components = {
    completeness: component(inputs.completeness, w.completeness),
    validity: component(inputs.validity, w.validity),
    uniqueness: component(inputs.uniqueness, w.uniqueness),
  };
  return { score: scoreOf(Object.values(components)), components };
}

export function computeQuality(profile: DatasetProfile, cfg: ScoringConfig = config): QualityResult {
  const { rowCount, duplicateRowCount, columns } = profile;

  let completeness: Unit;
  let validity: Unit;
  let uniqueness: Unit;
  if (rowCount === 0 || columns.length === 0) {
    // Empty file (06 §8): Completeness/Validity/Uniqueness := 0 → Quality 0, NaN-free.
    completeness = unit(0);
    validity = unit(0);
    uniqueness = unit(0);
  } else {
    completeness = unit(mean(columns.map((c) => c.nonNullCount / rowCount)));
    // nonNullCount = 0 → validity_col := 1 (vacuous: no present value can be invalid — 06 §8).
    validity = unit(mean(columns.map((c) => (c.nonNullCount === 0 ? 1 : c.typeMatchCount / c.nonNullCount))));
    uniqueness = unit(1 - duplicateRowCount / rowCount);
  }

  return qualityFromComponents({ completeness, validity, uniqueness }, cfg);
}

// --- Trust ⊇ Quality (06 §5) ----------------------------------------------
/** Weight the three already-derived Trust inputs (see qualityFromComponents for the why). */
export function trustFromComponents(
  inputs: { quality: Unit; consistency: Unit; classificationCoverage: Unit },
  detail: TrustResult["consistencyDetail"],
  cfg: ScoringConfig = config,
): TrustResult {
  const w = cfg.trust;
  const components = {
    quality: component(inputs.quality, w.quality),
    consistency: component(inputs.consistency, w.consistency),
    classificationCoverage: component(inputs.classificationCoverage, w.classificationCoverage),
  };
  return { score: scoreOf(Object.values(components)), components, consistencyDetail: detail };
}

export function computeTrust(
  quality: QualityResult,
  profile: DatasetProfile,
  cfg: ScoringConfig = config,
): TrustResult {
  const { columns, structuralIssues } = profile;

  // Fully-missing column → dominantTypeShare := 1 (vacuous, 06 §8).
  const meanDominantTypeShare = unit(mean(columns.map((c) => (c.nonNullCount === 0 ? 1 : c.dominantTypeShare))));
  const distinctIssues = new Set(structuralIssues).size;
  const structuralPenalty = unit(Math.min(cfg.structuralPenaltyCap, cfg.structuralPenaltyPerIssue * distinctIssues));
  const consistency = unit(meanDominantTypeShare * (1 - structuralPenalty));
  const classificationCoverage = unit(columns.length === 0 ? 0 : columns.filter((c) => c.isClassified).length / columns.length);
  const qualityUnit = unit(quality.score / 100);

  return trustFromComponents(
    { quality: qualityUnit, consistency, classificationCoverage },
    { meanDominantTypeShare, structuralPenalty, structuralIssues: [...structuralIssues] },
    cfg,
  );
}

// --- Value → recommendation (06 §7), total, first-match-wins --------------
export function recommend(
  score: Score,
  accesses90d: number,
  trend: Unit,
  cfg: ScoringConfig = config,
): ValueRecommendation {
  const { retireBelow, archiveBelow, optimizeBelow } = cfg.recommend;
  const isDeclining = trend < 0.5;
  if (accesses90d === 0 || score < retireBelow) return "RETIRE";
  if (score < archiveBelow && isDeclining) return "ARCHIVE";
  if (score < optimizeBelow) return "OPTIMIZE";
  return "KEEP";
}

// --- Value ⟂ Quality (06 §6) ----------------------------------------------
export function computeValue(events: AccessEvent[], now: Date, cfg: ScoringConfig = config): ValueResult {
  const w = cfg.value;
  const nowMs = now.getTime();

  let accesses90d = 0;
  let accessesLast30 = 0;
  let accessesPrev30 = 0;
  let maxOccurred = -Infinity;
  for (const e of events) {
    const t = e.occurredAt.getTime();
    if (t > maxOccurred) maxOccurred = t;
    if (t <= nowMs && t > nowMs - 90 * DAY_MS) accesses90d++;
    if (t <= nowMs && t > nowMs - 30 * DAY_MS) accessesLast30++;
    if (t <= nowMs - 30 * DAY_MS && t > nowMs - 60 * DAY_MS) accessesPrev30++;
  }
  // max(0, …) guards clock-skew / future-dated seed events (06 §6).
  const daysSinceLastAccess = events.length === 0 ? null : Math.max(0, (nowMs - maxOccurred) / DAY_MS);

  const frequency = unit(Math.log1p(accesses90d) / Math.log1p(cfg.freqCap));

  // Recency answers "was this used lately", but a single hit is not evidence of use — and at
  // 0.35 weight, letting it score 1.0 meant one click could carry a dead dataset. Scale it by
  // how much corroboration there is, so recency counts fully only once usage is real.
  const confidence = unit(accesses90d / cfg.recencyMinAccesses);
  const recency = unit(
    (daysSinceLastAccess === null ? 0 : Math.exp(-daysSinceLastAccess / cfg.halfLifeDays)) * confidence,
  );

  // A ratio against an empty prior period is not "infinite growth", it is an undefined trend.
  // Flooring the denominator makes the first few accesses read as barely-above-neutral and
  // requires sustained volume to earn a strong signal.
  const trend = unit(
    0.5 + (accessesLast30 - accessesPrev30) / (2 * Math.max(cfg.trendBaselineMin, accessesPrev30)),
  );

  const components = {
    frequency: component(frequency, w.frequency),
    recency: component(recency, w.recency),
    trend: component(trend, w.trend),
  };
  const score = scoreOf(Object.values(components));
  return {
    score,
    recommendation: recommend(score, accesses90d, trend, cfg),
    components,
    inputs: { accesses90d, accessesLast30, accessesPrev30, daysSinceLastAccess, isDeclining: trend < 0.5 },
  };
}

// --- Orchestration seam the ingestion service calls (06 §9) ---------------
export function scoreDataset(
  profile: DatasetProfile,
  events: AccessEvent[],
  now: Date,
  cfg: ScoringConfig = config,
): { quality: QualityResult; trust: TrustResult; value: ValueResult; breakdown: ScoreBreakdown } {
  const quality = computeQuality(profile, cfg);
  const trust = computeTrust(quality, profile, cfg);
  const value = computeValue(events, now, cfg);
  return { quality, trust, value, breakdown: { quality, trust, value } };
}
