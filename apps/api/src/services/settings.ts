// Runtime app settings (R3). One singleton row holds a PARTIAL override of the tunables in
// lib/config.ts; the effective settings are those overrides merged over the code defaults.
//
// Purity contract: domain/scoring.ts and domain/classification.ts stay pure. This service
// never mutates the imported `config` — it builds a plain ScoringConfig / ClassifyConfig and
// passes it in as each engine's optional trailing parameter, so every existing call site and
// every existing test keeps the static defaults.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type {
  AppSettings,
  AppSettingsKey,
  AppSettingsResponse,
  PiiCategory,
  RecomputeResult,
  ScoreBreakdown as WireScoreBreakdown,
} from "@assay/shared";
import { prisma } from "../lib/prisma";
import { fromZod } from "../lib/errors";
import { config, type ScoringConfig } from "../lib/config";
import { DEFAULT_SENSITIVITY, type ClassifyConfig } from "../domain/classification";
import { computeValue, qualityFromComponents, trustFromComponents, unit } from "../domain/scoring";
import { toWireBreakdown } from "./scoring";

const SINGLETON_ID = "singleton";

export const PII_CATEGORIES: PiiCategory[] = [
  "EMAIL", "PHONE", "ID_NUMBER", "CREDIT_CARD", "DATE_OF_BIRTH",
  "NAME", "ADDRESS", "IP_ADDRESS", "POSTAL_CODE", "NONE", "OTHER",
];

/** The code defaults, as the wire shape. Fresh objects — callers may keep/mutate their copy. */
export function defaultSettings(): AppSettings {
  return {
    quality: { ...config.quality },
    trust: { ...config.trust },
    value: { ...config.value },
    classifyThreshold: config.classifyThreshold,
    freqCap: config.freqCap,
    halfLifeDays: config.halfLifeDays,
    recommend: { ...config.recommend },
    sensitivity: { ...DEFAULT_SENSITIVITY },
  };
}

// --- Validation (04 §1.5: bad input → 422 validation_error) ---------------
const WEIGHT_SUM_TOLERANCE = 0.001;

/** A weight set is only meaningful if it sums to 1.0 — otherwise the score leaves 0–100. */
const sumsToOne = (w: Record<string, number>): boolean =>
  Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) <= WEIGHT_SUM_TOLERANCE;

const SUM_MESSAGE = "Weights must sum to 1.0 (±0.001).";
const weight = z.number().min(0).max(1);

// Spelled out rather than generated so the inferred type is exactly
// Record<PiiCategory, Sensitivity> — a mapped/`Object.fromEntries` shape widens to string keys.
const level = z.enum(["NONE", "LOW", "MEDIUM", "HIGH"]);
const sensitivityMapSchema = z.object({
  EMAIL: level,
  PHONE: level,
  ID_NUMBER: level,
  CREDIT_CARD: level,
  DATE_OF_BIRTH: level,
  NAME: level,
  ADDRESS: level,
  IP_ADDRESS: level,
  POSTAL_CODE: level,
  NONE: level,
  OTHER: level,
});

export const settingsPatchSchema = z
  .object({
    quality: z
      .object({ completeness: weight, validity: weight, uniqueness: weight })
      .refine(sumsToOne, { message: SUM_MESSAGE }),
    trust: z
      .object({ quality: weight, consistency: weight, classificationCoverage: weight })
      .refine(sumsToOne, { message: SUM_MESSAGE }),
    value: z
      .object({ frequency: weight, recency: weight, trend: weight })
      .refine(sumsToOne, { message: SUM_MESSAGE }),
    classifyThreshold: z.number().min(0).max(1),
    freqCap: z.number().int().min(1).max(100_000),
    halfLifeDays: z.number().min(0.5).max(3650),
    recommend: z
      .object({
        retireBelow: z.number().min(0).max(100),
        archiveBelow: z.number().min(0).max(100),
        optimizeBelow: z.number().min(0).max(100),
      })
      // First-match-wins in `recommend()`, so an out-of-order set silently makes a band
      // unreachable. Rejecting it is cheaper than debugging a recommendation that never fires.
      .refine((r) => r.retireBelow <= r.archiveBelow && r.archiveBelow <= r.optimizeBelow, {
        message: "Cutoffs must ascend: RETIRE ≤ ARCHIVE ≤ OPTIMIZE.",
      }),
    sensitivity: sensitivityMapSchema,
  })
  .partial()
  .strict();

// --- Persistence ---------------------------------------------------------
type StoredPayload = Partial<AppSettings>;

async function readPayload(): Promise<{ payload: StoredPayload; updatedAt: Date | null }> {
  const row = await prisma.appSettings.findUnique({ where: { id: SINGLETON_ID } });
  if (!row) return { payload: {}, updatedAt: null };
  return { payload: (row.payload as StoredPayload | null) ?? {}, updatedAt: row.updatedAt };
}

/** Overrides merged over the defaults, one top-level key at a time (a key is replaced whole). */
function merge(payload: StoredPayload): AppSettings {
  return { ...defaultSettings(), ...payload };
}

function respond(payload: StoredPayload, updatedAt: Date | null): AppSettingsResponse {
  return {
    settings: merge(payload),
    defaults: defaultSettings(),
    overridden: Object.keys(payload) as AppSettingsKey[],
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}

export async function getSettings(): Promise<AppSettingsResponse> {
  const { payload, updatedAt } = await readPayload();
  return respond(payload, updatedAt);
}

/** The effective settings — what ingestion and recompute actually run with. */
export async function getEffectiveSettings(): Promise<AppSettings> {
  const { payload } = await readPayload();
  return merge(payload);
}

/** Partial update. Present keys replace wholesale; absent keys keep whatever was stored. */
export async function patchSettings(body: unknown): Promise<AppSettingsResponse> {
  const parsed = settingsPatchSchema.safeParse(body);
  if (!parsed.success) throw fromZod(parsed.error);

  const { payload } = await readPayload();
  const next: StoredPayload = { ...payload, ...parsed.data };
  const row = await prisma.appSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, payload: next as unknown as Prisma.InputJsonValue },
    update: { payload: next as unknown as Prisma.InputJsonValue },
  });
  return respond(next, row.updatedAt);
}

/** Drop every override — back to the code defaults. Idempotent when no row exists. */
export async function resetSettings(): Promise<AppSettingsResponse> {
  await prisma.appSettings.deleteMany({ where: { id: SINGLETON_ID } });
  return respond({}, null);
}

// --- Adapters into the pure engines --------------------------------------
/** structuralPenalty* are not operator-tunable, so they always come from the code default. */
export function toScoringConfig(s: AppSettings): ScoringConfig {
  return {
    quality: s.quality,
    trust: s.trust,
    value: s.value,
    classifyThreshold: s.classifyThreshold,
    freqCap: s.freqCap,
    halfLifeDays: s.halfLifeDays,
    structuralPenaltyPerIssue: config.structuralPenaltyPerIssue,
    structuralPenaltyCap: config.structuralPenaltyCap,
    recommend: s.recommend,
  };
}

export function toClassifyConfig(s: AppSettings): ClassifyConfig {
  return { classifyThreshold: s.classifyThreshold, sensitivity: s.sensitivity };
}

// --- Recompute -----------------------------------------------------------
/**
 * Re-score every dataset with the current effective settings, then re-map every
 * non-overridden classification tag onto the sensitivity map.
 *
 * What can honestly be recomputed: the component *values* (completeness, validity,
 * uniqueness, consistency, coverage) are properties of the file, not of the settings — we
 * persist them in `scoreBreakdown` and re-weight them. Value is derived from scratch from the
 * dataset's AccessEvents, so freqCap / halfLifeDays / the Value weights / the recommendation
 * cutoffs all take effect. A dataset without a stored breakdown (FAILED, or PROCESSING) is
 * skipped rather than invented — it never had scores to re-weight.
 *
 * classifyThreshold is NOT retroactive: re-deciding a column's category needs the raw values,
 * which we deliberately never store (03 §6). It applies to subsequent ingests; the UI says so.
 *
 * ponytail: loads all access events into memory in one query and updates row-by-row inside a
 * transaction — right at demo/catalog scale. Batch by dataset id if the catalog ever grows.
 */
export async function recomputeAllScores(now = new Date()): Promise<RecomputeResult> {
  const settings = await getEffectiveSettings();
  const cfg = toScoringConfig(settings);

  const datasets = await prisma.dataset.findMany({
    select: { id: true, scoreBreakdown: true },
  });
  const events = await prisma.accessEvent.findMany({ select: { datasetId: true, occurredAt: true } });
  const eventsByDataset = new Map<string, { occurredAt: Date }[]>();
  for (const e of events) {
    const list = eventsByDataset.get(e.datasetId);
    if (list) list.push({ occurredAt: e.occurredAt });
    else eventsByDataset.set(e.datasetId, [{ occurredAt: e.occurredAt }]);
  }

  const updates: Prisma.PrismaPromise<unknown>[] = [];
  let skipped = 0;

  for (const ds of datasets) {
    const stored = ds.scoreBreakdown as unknown as WireScoreBreakdown | null;
    if (!stored) {
      skipped++;
      continue;
    }

    const quality = qualityFromComponents(
      {
        completeness: unit(stored.quality.inputs.completeness),
        validity: unit(stored.quality.inputs.validity),
        uniqueness: unit(stored.quality.inputs.uniqueness),
      },
      cfg,
    );
    const trust = trustFromComponents(
      {
        quality: unit(quality.score / 100),
        consistency: unit(stored.trust.inputs.consistency),
        classificationCoverage: unit(stored.trust.inputs.classificationCoverage),
      },
      // The consistency detail is a property of the file; carry the stored penalty forward.
      { meanDominantTypeShare: unit(stored.trust.inputs.consistency), structuralPenalty: unit(0), structuralIssues: [] },
      cfg,
    );
    const value = computeValue(eventsByDataset.get(ds.id) ?? [], now, cfg);
    const breakdown = toWireBreakdown(quality, trust, value, cfg);

    updates.push(
      prisma.dataset.update({
        where: { id: ds.id },
        data: {
          qualityScore: quality.score,
          trustScore: trust.score,
          valueScore: value.score,
          valueRecommendation: value.recommendation,
          scoreBreakdown: breakdown as unknown as Prisma.InputJsonValue,
        },
      }),
    );
  }

  // Re-map auto-assigned tags onto the sensitivity map. MANUAL overrides are a human decision
  // and are never touched (07 §8).
  const tagUpdates = PII_CATEGORIES.map((category) =>
    prisma.classificationTag.updateMany({
      where: { category, overridden: false, sensitivity: { not: settings.sensitivity[category] } },
      data: { sensitivity: settings.sensitivity[category] },
    }),
  );

  const results = await prisma.$transaction([...updates, ...tagUpdates]);
  const tagsUpdated = results
    .slice(updates.length)
    .reduce<number>((sum, r) => sum + (r as { count: number }).count, 0);

  return { updated: updates.length, skipped, tagsUpdated };
}
