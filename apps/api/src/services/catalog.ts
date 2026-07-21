// Catalog reads (04 §2.3–2.4). List = offset pagination + sort + null-safe
// sensitivity/recommendation filters (those signals arrive in Phase 2/3, so they
// simply match nothing today). Detail = summary + columns; scoreBreakdown,
// qualityChecks, healthNarrative, and usage are Phase 2/3 and returned empty/null.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { DatasetDetail, DatasetSummary, PaginationMeta, UsageSeries } from "@assay/shared";
import { prisma } from "../lib/prisma";
import { toColumnDTO, toDatasetSummary } from "./serialize";

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
    }),
  ]);

  const items = rows.map(toDatasetSummary);
  return { items, meta: { total, limit: query.limit, offset: query.offset, count: items.length } };
}

export async function getDatasetDetail(id: string): Promise<DatasetDetail | null> {
  const dataset = await prisma.dataset.findUnique({
    where: { id },
    include: { columns: { orderBy: { position: "asc" } } },
  });
  if (!dataset) return null;

  const detail: DatasetDetail = {
    ...toDatasetSummary(dataset),
    scoreBreakdown: null, // Phase 2
    healthNarrative: null, // Phase 2 (AI, graceful)
    columns: dataset.columns.map(toColumnDTO),
    qualityChecks: [], // Phase 2
    usage: emptyUsage(dataset.id), // Phase 3 fills this from AccessEvents
  };
  if (dataset.sampleRows != null) {
    detail.sampleRows = dataset.sampleRows as unknown as Record<string, unknown>[];
  }
  return detail;
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
