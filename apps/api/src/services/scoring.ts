// Ingestion-time scoring adapter (10 §3 Task 2.4). Bridges the profiling output
// (domain/profile.ProfiledColumn) into the 06-canonical DatasetProfile the scoring
// engine consumes, runs scoreDataset, and flattens the component breakdown into the
// wire ScoreBreakdown DTO (04 §4) persisted on Dataset.scoreBreakdown.
import type { ScoreBreakdown as WireScoreBreakdown, ValueRecommendation } from "@assay/shared";
import type { DatasetProfile as ProfilingResult } from "../domain/profile";
import {
  scoreDataset,
  type QualityResult,
  type TrustResult,
  type ValueResult,
  type AccessEvent,
  type DatasetProfile as ScoringProfile,
} from "../domain/scoring";
import { config } from "../lib/config";

export interface ScoredDataset {
  qualityScore: number;
  trustScore: number;
  valueScore: number;
  valueRecommendation: ValueRecommendation;
  scoreBreakdown: WireScoreBreakdown;
}

/**
 * Score a profiled dataset. `allClassified` is true once every column carries a resolved
 * tag (07 §9 — always true post-ingest, incl. explicit NONE), driving ClassificationCoverage.
 * `events` is empty at ingest (Value is usage-only, filled by Phase 3), so brand-new datasets
 * score low Value → RETIRE (06 §8 / R10 — correct by design).
 */
export function scoreProfiledDataset(
  profile: ProfilingResult,
  allClassified: boolean,
  events: AccessEvent[],
  now: Date,
): ScoredDataset {
  const scoringProfile: ScoringProfile = {
    rowCount: profile.rowCount,
    duplicateRowCount: profile.duplicateRowCount,
    structuralIssues: profile.structuralIssues,
    columns: profile.columns.map((c) => ({
      name: c.name,
      position: c.position,
      dataType: c.dataType,
      rowCount: profile.rowCount,
      nonNullCount: c.nonNullCount,
      typeMatchCount: c.typeMatchCount,
      dominantTypeShare: c.dominantTypeShare,
      distinctCount: c.distinctCount,
      isClassified: allClassified,
    })),
  };

  const { quality, trust, value } = scoreDataset(scoringProfile, events, now);
  return {
    qualityScore: quality.score,
    trustScore: trust.score,
    valueScore: value.score,
    valueRecommendation: value.recommendation,
    scoreBreakdown: toWireBreakdown(quality, trust, value),
  };
}

/** Flatten domain {value,weight,contribution} components into the wire {inputs,weights} DTO. */
export function toWireBreakdown(q: QualityResult, t: TrustResult, v: ValueResult): WireScoreBreakdown {
  return {
    quality: {
      score: q.score,
      inputs: {
        completeness: q.components.completeness.value,
        validity: q.components.validity.value,
        uniqueness: q.components.uniqueness.value,
      },
      weights: {
        completeness: q.components.completeness.weight,
        validity: q.components.validity.weight,
        uniqueness: q.components.uniqueness.weight,
      },
    },
    trust: trustBreakdown(
      t.components.quality.value,
      t.components.consistency.value,
      t.components.classificationCoverage.value,
      t.score,
    ),
    value: {
      score: v.score,
      inputs: {
        frequency: v.components.frequency.value,
        recency: v.components.recency.value,
        trend: v.components.trend.value,
      },
      weights: {
        frequency: v.components.frequency.weight,
        recency: v.components.recency.weight,
        trend: v.components.trend.weight,
      },
      raw: {
        accesses90d: v.inputs.accesses90d,
        accessesLast30: v.inputs.accessesLast30,
        accessesPrev30: v.inputs.accessesPrev30,
        // Wire DTO is non-nullable; never-accessed (null) renders as 0 (Recency already 0).
        daysSinceLastAccess: v.inputs.daysSinceLastAccess ?? 0,
        freqCap: config.freqCap,
        halfLife: config.halfLifeDays,
      },
    },
  };
}

/**
 * Build the wire Trust sub-breakdown from its three [0,1] inputs. Shared by ingest scoring
 * and the manual-override recompute (07 §8) — the invariant is
 * score = 100·(0.45·quality + 0.30·consistency + 0.25·coverage). Pass `score` to reuse the
 * engine's already-computed value, or omit it to derive from the weights here.
 */
export function trustBreakdown(
  quality: number,
  consistency: number,
  classificationCoverage: number,
  score?: number,
): WireScoreBreakdown["trust"] {
  const w = config.trust;
  return {
    score:
      score ??
      100 * (w.quality * quality + w.consistency * consistency + w.classificationCoverage * classificationCoverage),
    inputs: { quality, consistency, classificationCoverage },
    weights: { quality: w.quality, consistency: w.consistency, classificationCoverage: w.classificationCoverage },
  };
}
