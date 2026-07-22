// Catalog reads (04 §2.3–2.4) + usage series (04 §2.6) + manual override (04 §2.5).
// List = offset pagination + sort + sensitivity/recommendation filters. Detail = summary +
// columns (with tags), score breakdown, quality checks, narrative, and the usage series; a
// tracked detail view records a LIVE DETAIL_VIEW and recomputes Value (value-on-read, 04 §2.4).
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type {
  AccessType,
  ClassificationOverrideResponse,
  DatasetDetail,
  DatasetOverview,
  DatasetStatus,
  DatasetSummary,
  PaginationMeta,
  ScoreBreakdown,
  Sensitivity,
  UsagePoint,
  UsageSeries,
  ValueRecommendation,
} from "@assay/shared";
import { prisma } from "../lib/prisma";
import { ApiHttpError, fromZod } from "../lib/errors";
import { DEFAULT_SENSITIVITY } from "../domain/classification";
import { computeValue } from "../domain/scoring";
import { trustBreakdown, valueBreakdown } from "./scoring";
import { toColumnDTO, toDatasetSummary, toQualityCheckDTO } from "./serialize";

const DAY_MS = 86_400_000;
const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// Included column shape carrying the 1:1 tag — used by detail and the override response.
const columnWithTag = { include: { classificationTag: true } } as const;

const SORT_VALUES = [
  "uploadedAt", "-uploadedAt", "name", "-name",
  "qualityScore", "-qualityScore", "trustScore", "-trustScore",
  "valueScore", "-valueScore", "rowCount", "-rowCount",
] as const;

export const catalogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(SORT_VALUES).default("-uploadedAt"),
  sensitivity: z.enum(["NONE", "LOW", "MEDIUM", "HIGH"]).optional(),
  recommendation: z.enum(["KEEP", "OPTIMIZE", "ARCHIVE", "RETIRE"]).optional(),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

const NULLABLE_SCORE_SORTS = new Set(["qualityScore", "trustScore", "valueScore"]);

// Null scores always sort last so a PROCESSING/FAILED dataset never outranks a
// scored one, regardless of direction (04 §1.6).
function orderByFor(sort: string): Prisma.DatasetOrderByWithRelationInput {
  const desc = sort.startsWith("-");
  const field = desc ? sort.slice(1) : sort;
  const dir: Prisma.SortOrder = desc ? "desc" : "asc";
  if (NULLABLE_SCORE_SORTS.has(field)) {
    return { [field]: { sort: dir, nulls: "last" } } as Prisma.DatasetOrderByWithRelationInput;
  }
  return { [field]: dir } as Prisma.DatasetOrderByWithRelationInput;
}

export async function listDatasets(
  query: CatalogQuery,
): Promise<{ items: DatasetSummary[]; meta: PaginationMeta }> {
  const where: Prisma.DatasetWhereInput = {};
  if (query.recommendation) where.valueRecommendation = query.recommendation;
  if (query.sensitivity) {
    where.columns = { some: { classificationTag: { sensitivity: query.sensitivity } } };
  }

  const [total, rows] = await prisma.$transaction([
    prisma.dataset.count({ where }),
    prisma.dataset.findMany({
      where,
      orderBy: orderByFor(query.sort),
      skip: query.offset,
      take: query.limit,
      // Tag sensitivities feed derived piiColumnCount + highestSensitivity (badge/filter).
      include: { columns: { select: { classificationTag: { select: { sensitivity: true } } } } },
    }),
  ]);

  // Derive the page's usage roll-up in two grouped scans, never per-row: one over all
  // events (total "usage/view count" + max occurredAt), one over the trailing 90 days.
  // Prisma has no per-aggregate FILTER, so the window needs its own groupBy.
  const ids = rows.map((r) => r.id);
  const since = new Date(Date.now() - 90 * DAY_MS);
  const [allTime, recent] = ids.length
    ? await Promise.all([
        prisma.accessEvent.groupBy({
          by: ["datasetId"],
          where: { datasetId: { in: ids } },
          _count: { _all: true },
          _max: { occurredAt: true },
        }),
        prisma.accessEvent.groupBy({
          by: ["datasetId"],
          where: { datasetId: { in: ids }, occurredAt: { gte: since } },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const allTimeMap = new Map(allTime.map((g) => [g.datasetId, g]));
  const recentMap = new Map(recent.map((g) => [g.datasetId, g._count._all]));

  const items = rows.map((r) =>
    toDatasetSummary(r, r.columns, {
      lastAccessedAt: allTimeMap.get(r.id)?._max.occurredAt?.toISOString() ?? null,
      accessCount: allTimeMap.get(r.id)?._count._all ?? 0,
      accessCount90d: recentMap.get(r.id) ?? 0,
    }),
  );
  return { items, meta: { total, limit: query.limit, offset: query.offset, count: items.length } };
}

// --- Dashboard overview aggregate (R1.2) ---------------------------------
// Catalog-wide roll-up for the dashboard home. A handful of cheap grouped
// counts/aggregates run concurrently — no per-dataset serialization. Independent
// read-only queries, so Promise.all (not a transaction): an overview is inherently
// eventually-consistent and this keeps Prisma's per-call result types precise.
// Averages come from Prisma _avg (which already ignores null scores), so they
// reflect only the datasets that carry each score; distributions fill every key.
const SENSITIVITY_LEVELS: Sensitivity[] = ["NONE", "LOW", "MEDIUM", "HIGH"];
const RECOMMENDATIONS: ValueRecommendation[] = ["KEEP", "OPTIMIZE", "ARCHIVE", "RETIRE"];

const round1 = (n: number | null): number => (n == null ? 0 : Math.round(n * 10) / 10);

export async function getOverview(): Promise<DatasetOverview> {
  const [agg, byStatus, byRecommendation, bySensitivity, recent, attention] = await Promise.all([
    prisma.dataset.aggregate({
      _count: true,
      _avg: { qualityScore: true, trustScore: true, valueScore: true },
      _sum: { rowCount: true, columnCount: true },
    }),
    prisma.dataset.groupBy({ by: ["status"], _count: true, orderBy: { status: "asc" } }),
    prisma.dataset.groupBy({ by: ["valueRecommendation"], _count: true, orderBy: { valueRecommendation: "asc" } }),
    prisma.classificationTag.groupBy({ by: ["sensitivity"], _count: true, orderBy: { sensitivity: "asc" } }),
    prisma.dataset.findMany({
      orderBy: { uploadedAt: "desc" },
      take: 5,
      select: { id: true, name: true, uploadedAt: true, qualityScore: true },
    }),
    // RETIRE-recommended or FAILED — the datasets a steward should look at first.
    prisma.dataset.findMany({
      where: { OR: [{ status: "FAILED" }, { valueRecommendation: "RETIRE" }] },
      orderBy: { uploadedAt: "desc" },
      take: 10,
      select: { id: true, name: true, valueRecommendation: true, status: true },
    }),
  ]);

  const statusCount = (s: DatasetStatus): number => byStatus.find((g) => g.status === s)?._count ?? 0;

  const sensitivityDistribution = Object.fromEntries(
    SENSITIVITY_LEVELS.map((level) => [level, bySensitivity.find((g) => g.sensitivity === level)?._count ?? 0]),
  ) as Record<Sensitivity, number>;

  const recommendationDistribution = Object.fromEntries(
    RECOMMENDATIONS.map((r) => [r, byRecommendation.find((g) => g.valueRecommendation === r)?._count ?? 0]),
  ) as Record<ValueRecommendation, number>;

  return {
    totalDatasets: agg._count,
    ready: statusCount("READY"),
    failed: statusCount("FAILED"),
    processing: statusCount("PROCESSING"),
    avgQuality: round1(agg._avg.qualityScore),
    avgTrust: round1(agg._avg.trustScore),
    avgValue: round1(agg._avg.valueScore),
    totalRows: agg._sum.rowCount ?? 0,
    totalColumns: agg._sum.columnCount ?? 0,
    piiColumnCount: sensitivityDistribution.LOW + sensitivityDistribution.MEDIUM + sensitivityDistribution.HIGH,
    sensitivityDistribution,
    recommendationDistribution,
    recentUploads: recent.map((r) => ({
      id: r.id,
      name: r.name,
      uploadedAt: r.uploadedAt.toISOString(),
      qualityScore: r.qualityScore,
    })),
    needsAttention: attention.map((a) => ({
      id: a.id,
      name: a.name,
      valueRecommendation: a.valueRecommendation,
      status: a.status,
    })),
  };
}

// GET /:id validates ?track (bad value → 422); default true preserves the spec side effect.
export const detailQuerySchema = z.object({
  track: z.enum(["true", "false"]).default("true"),
});

/**
 * Full nested detail (04 §2.4). Unless `?track=false`, a detail view is itself the Data-Value
 * signal: it records a LIVE `DETAIL_VIEW` and recomputes Value from ALL of the dataset's events.
 * Only a READY dataset carries scores, so tracking is gated on it — a FAILED/PROCESSING dataset
 * keeps its null scores (R1) rather than being resurrected by a view.
 */
export async function getDatasetDetail(id: string, track: boolean): Promise<DatasetDetail | null> {
  const now = new Date();
  const existing = await prisma.dataset.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return null;

  if (track && existing.status === "READY") {
    await prisma.accessEvent.create({ data: { datasetId: id, type: "DETAIL_VIEW", source: "LIVE", occurredAt: now } });
    await recomputeDatasetValue(id, now);
  }

  const dataset = await prisma.dataset.findUniqueOrThrow({
    where: { id },
    include: {
      columns: { orderBy: { position: "asc" }, ...columnWithTag },
      qualityChecks: { orderBy: { createdAt: "asc" } },
    },
  });
  // The unfiltered 90-day series already carries lastAccessedAt + accesses90d; only the
  // all-time "usage/view count" needs its own (indexed, single-column) count.
  const [usage, accessCount] = await Promise.all([
    buildUsageSeries(id, 90, undefined, now),
    prisma.accessEvent.count({ where: { datasetId: id } }),
  ]);

  const detail: DatasetDetail = {
    // lastAccessedAt is the usage summary's — one derivation feeds both the summary and this block.
    ...toDatasetSummary(dataset, dataset.columns, {
      lastAccessedAt: usage.summary.lastAccessedAt,
      accessCount,
      accessCount90d: usage.summary.accesses90d,
    }),
    // Stored as the wire shape at ingest (04 §4); null for a FAILED dataset that never scored.
    scoreBreakdown: (dataset.scoreBreakdown as unknown as ScoreBreakdown | null) ?? null,
    healthNarrative: dataset.healthNarrative, // null when AI disabled (graceful)
    columns: dataset.columns.map(toColumnDTO),
    qualityChecks: dataset.qualityChecks.map(toQualityCheckDTO),
    usage,
  };
  if (dataset.sampleRows != null) {
    detail.sampleRows = dataset.sampleRows as unknown as Record<string, unknown>[];
  }
  return detail;
}

/**
 * Recompute Value from ALL of a dataset's access events and persist it (04 §2.4). Shared by
 * value-on-read (GET /:id) and the seed, so seeded usage and live views run the exact same code.
 * Quality/Trust are usage-independent and left untouched — only the Value block is spliced into
 * the stored breakdown. Appends a ScoreSnapshot for the trend sparkline.
 * Deliberate simplification: one snapshot per recompute — fine at demo scale; prune by capturedAt if it ever grows.
 */
export async function recomputeDatasetValue(datasetId: string, now = new Date()): Promise<void> {
  const events = await prisma.accessEvent.findMany({ where: { datasetId }, select: { occurredAt: true } });
  const value = computeValue(events, now);

  const ds = await prisma.dataset.findUniqueOrThrow({
    where: { id: datasetId },
    select: { scoreBreakdown: true, qualityScore: true, trustScore: true },
  });
  const stored = ds.scoreBreakdown as unknown as ScoreBreakdown | null;
  const breakdown = stored ? { ...stored, value: valueBreakdown(value) } : null;

  await prisma.dataset.update({
    where: { id: datasetId },
    data: {
      valueScore: value.score,
      valueRecommendation: value.recommendation,
      ...(breakdown ? { scoreBreakdown: breakdown as unknown as Prisma.InputJsonValue } : {}),
    },
  });

  // A snapshot needs all three scores; only a scored (READY) dataset has Quality/Trust.
  if (ds.qualityScore != null && ds.trustScore != null) {
    await prisma.scoreSnapshot.create({
      data: { datasetId, qualityScore: ds.qualityScore, trustScore: ds.trustScore, valueScore: value.score },
    });
  }
}

// --- Usage time-series (04 §2.6) -----------------------------------------
export const usageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
  type: z.enum(["VIEW", "DETAIL_VIEW", "DOWNLOAD"]).optional(),
});
export type UsageQueryInput = z.infer<typeof usageQuerySchema>;

/**
 * Zero-filled daily access series + fixed-window summary (04 §2.6). `days` sizes the *series*
 * window only ([to−days .. to], `days` buckets, no gaps); the summary always reports the
 * 90/30/prev-30 windows Value uses — so the detail block (unfiltered, 90d) matches the Value
 * score. A `type` filter narrows the whole view (series and summary).
 */
async function buildUsageSeries(
  datasetId: string,
  days: number,
  type: AccessType | undefined,
  now: Date,
): Promise<UsageSeries> {
  const events = await prisma.accessEvent.findMany({
    where: { datasetId, ...(type ? { type } : {}) },
    select: { type: true, occurredAt: true },
  });
  const nowMs = now.getTime();

  // Pre-seed `days` daily buckets [to−(days−1) .. to] so the chart renders without gaps.
  const buckets = new Map<string, Record<AccessType, number>>();
  for (let i = 0; i < days; i++) {
    buckets.set(utcDay(nowMs - i * DAY_MS), { VIEW: 0, DETAIL_VIEW: 0, DOWNLOAD: 0 });
  }

  let accesses90d = 0;
  let accessesLast30 = 0;
  let accessesPrev30 = 0;
  let maxMs = -Infinity;
  for (const e of events) {
    const t = e.occurredAt.getTime();
    if (t > maxMs) maxMs = t;
    // Windows match computeValue exactly (06 §6): half-open, anchored at now.
    if (t <= nowMs && t > nowMs - 90 * DAY_MS) accesses90d++;
    if (t <= nowMs && t > nowMs - 30 * DAY_MS) accessesLast30++;
    if (t <= nowMs - 30 * DAY_MS && t > nowMs - 60 * DAY_MS) accessesPrev30++;
    const bucket = buckets.get(utcDay(t)); // undefined = outside the series window (still counted above)
    if (bucket) bucket[e.type]++;
  }

  const series: UsagePoint[] = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, byType]) => ({ date, total: byType.VIEW + byType.DETAIL_VIEW + byType.DOWNLOAD, byType }));

  return {
    datasetId,
    from: utcDay(nowMs - days * DAY_MS),
    to: utcDay(nowMs),
    series,
    summary: {
      accesses90d,
      accessesLast30,
      accessesPrev30,
      lastAccessedAt: maxMs === -Infinity ? null : new Date(maxMs).toISOString(),
    },
  };
}

export async function getDatasetUsage(id: string, query: UsageQueryInput): Promise<UsageSeries> {
  const exists = await prisma.dataset.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new ApiHttpError(404, "dataset_not_found", "No dataset with that id.");
  return buildUsageSeries(id, query.days, query.type, new Date());
}

// --- Manual override (04 §2.5 / 07 §8) -----------------------------------
const overrideBodySchema = z.object({
  category: z.enum([
    "EMAIL", "PHONE", "ID_NUMBER", "CREDIT_CARD", "DATE_OF_BIRTH",
    "NAME", "ADDRESS", "IP_ADDRESS", "POSTAL_CODE", "NONE", "OTHER",
  ]),
  sensitivity: z.enum(["NONE", "LOW", "MEDIUM", "HIGH"]).optional(),
});

/**
 * Apply a MANUAL classification tag and recompute Trust (07 §8). The override guarantees the
 * column is classified, so ClassificationCoverage → Trust may move; Quality and Value are
 * untouched (Value is usage-only, Quality is classification-independent). Consistency and
 * Quality are read back from the persisted breakdown — only coverage changes.
 */
export async function overrideClassification(
  datasetId: string,
  columnId: string,
  body: unknown,
): Promise<ClassificationOverrideResponse> {
  const parsed = overrideBodySchema.safeParse(body);
  if (!parsed.success) throw fromZod(parsed.error);
  const { category } = parsed.data;
  const sensitivity = parsed.data.sensitivity ?? DEFAULT_SENSITIVITY[category];

  const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
  if (!dataset) throw new ApiHttpError(404, "dataset_not_found", "No dataset with that id.");

  const column = await prisma.column.findFirst({ where: { id: columnId, datasetId } });
  if (!column) throw new ApiHttpError(404, "column_not_found", "No column with that id under this dataset.");

  // Upsert the 1:1 tag: a human decision (source MANUAL, overridden, no match-share confidence).
  await prisma.classificationTag.upsert({
    where: { columnId },
    create: { columnId, category, sensitivity, source: "MANUAL", confidence: null, overridden: true },
    update: { category, sensitivity, source: "MANUAL", confidence: null, overridden: true },
  });

  // Recompute ClassificationCoverage → Trust. Quality + Consistency are stable properties of the
  // data (unchanged by a tag edit) and are read back from the stored breakdown.
  const classifiedCount = await prisma.classificationTag.count({ where: { column: { datasetId } } });
  const coverage = dataset.columnCount > 0 ? classifiedCount / dataset.columnCount : 0;
  const stored = dataset.scoreBreakdown as unknown as ScoreBreakdown | null;
  const qualityUnit = (dataset.qualityScore ?? 0) / 100;
  const consistency = stored?.trust.inputs.consistency ?? 0;
  const trust = trustBreakdown(qualityUnit, consistency, coverage);

  const updatedBreakdown = stored ? { ...stored, trust } : null;
  const updated = await prisma.dataset.update({
    where: { id: datasetId },
    data: {
      trustScore: trust.score,
      ...(updatedBreakdown ? { scoreBreakdown: updatedBreakdown as unknown as Prisma.InputJsonValue } : {}),
    },
  });

  const columnDTO = await prisma.column.findUniqueOrThrow({ where: { id: columnId }, ...columnWithTag });
  return {
    column: toColumnDTO(columnDTO),
    dataset: {
      id: updated.id,
      qualityScore: updated.qualityScore,
      trustScore: updated.trustScore,
      valueScore: updated.valueScore,
      updatedAt: updated.updatedAt.toISOString(),
      scoreBreakdown: { trust },
    },
  };
}
