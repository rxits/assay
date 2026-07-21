// Catalog reads (04 §2.3–2.4) + manual override (04 §2.5). List = offset pagination
// + sort + sensitivity/recommendation filters. Detail = summary + columns (with tags),
// score breakdown, quality checks, and health narrative; usage stays Phase 3 (empty).
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type {
  ClassificationOverrideResponse,
  DatasetDetail,
  DatasetSummary,
  PaginationMeta,
  ScoreBreakdown,
  UsageSeries,
} from "@assay/shared";
import { prisma } from "../lib/prisma";
import { ApiHttpError, fromZod } from "../lib/errors";
import { DEFAULT_SENSITIVITY } from "../domain/classification";
import { trustBreakdown } from "./scoring";
import { toColumnDTO, toDatasetSummary, toQualityCheckDTO } from "./serialize";

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

  const items = rows.map((r) => toDatasetSummary(r, r.columns));
  return { items, meta: { total, limit: query.limit, offset: query.offset, count: items.length } };
}

export async function getDatasetDetail(id: string): Promise<DatasetDetail | null> {
  const dataset = await prisma.dataset.findUnique({
    where: { id },
    include: {
      columns: { orderBy: { position: "asc" }, ...columnWithTag },
      qualityChecks: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!dataset) return null;

  const detail: DatasetDetail = {
    ...toDatasetSummary(dataset, dataset.columns),
    // Stored as the wire shape at ingest (04 §4); null for a FAILED dataset that never scored.
    scoreBreakdown: (dataset.scoreBreakdown as unknown as ScoreBreakdown | null) ?? null,
    healthNarrative: dataset.healthNarrative, // null when AI disabled (graceful)
    columns: dataset.columns.map(toColumnDTO),
    qualityChecks: dataset.qualityChecks.map(toQualityCheckDTO),
    usage: emptyUsage(dataset.id), // Phase 3 fills this from AccessEvents
  };
  if (dataset.sampleRows != null) {
    detail.sampleRows = dataset.sampleRows as unknown as Record<string, unknown>[];
  }
  return detail;
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

// A zero-filled 90-day window so the Phase-3 usage chart has a shape to render
// even before any access events exist.
function emptyUsage(datasetId: string): UsageSeries {
  const to = new Date();
  const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  return {
    datasetId,
    from: iso(from),
    to: iso(to),
    series: [],
    summary: { accesses90d: 0, accessesLast30: 0, accessesPrev30: 0, lastAccessedAt: null },
  };
}
