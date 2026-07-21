// Prisma row -> wire DTO mappers. Shared by ingest (POST response) and catalog
// (list/detail). Phase 2B wires classification tags, derived PII fields, and quality
// checks; usage/lastAccessedAt remain Phase 3 (stubbed 0/null).
import type { Column, ClassificationTag, Dataset, QualityCheck } from "@prisma/client";
import type { ClassificationTagDTO, ColumnDTO, DatasetSummary, QualityCheckDTO, Sensitivity } from "@assay/shared";

type ColumnWithTag = Column & { classificationTag: ClassificationTag | null };

// Only PII sensitivity (> NONE) is reported; a column resolved to NONE is classified but not PII.
const SENSITIVITY_RANK: Record<Sensitivity, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

/** Derive piiColumnCount + highestSensitivity from included column tags (00-SPEC §6). */
export function derivePii(
  columns: { classificationTag: { sensitivity: Sensitivity } | null }[] | undefined,
): { piiColumnCount: number; highestSensitivity: Sensitivity | null } {
  let piiColumnCount = 0;
  let highestSensitivity: Sensitivity | null = null;
  for (const c of columns ?? []) {
    const s = c.classificationTag?.sensitivity;
    if (!s || s === "NONE") continue;
    piiColumnCount++;
    if (highestSensitivity === null || SENSITIVITY_RANK[s] > SENSITIVITY_RANK[highestSensitivity]) {
      highestSensitivity = s;
    }
  }
  return { piiColumnCount, highestSensitivity };
}

/** Usage roll-up for one dataset, derived by the caller (grouped scan / count — never N+1). */
export interface AccessRollup {
  lastAccessedAt: string | null; // max AccessEvent.occurredAt (ISO)
  accessCount: number; // total AccessEvents — the brief's "usage/view count"
  accessCount90d: number; // AccessEvents in the trailing 90-day window
}

const NO_ACCESS: AccessRollup = { lastAccessedAt: null, accessCount: 0, accessCount90d: 0 };

export function toDatasetSummary(
  d: Dataset,
  columns?: { classificationTag: { sensitivity: Sensitivity } | null }[],
  access: AccessRollup = NO_ACCESS,
): DatasetSummary {
  const { piiColumnCount, highestSensitivity } = derivePii(columns);
  return {
    id: d.id,
    name: d.name,
    originalFilename: d.originalFilename,
    fileType: d.fileType,
    sizeBytes: d.sizeBytes,
    rowCount: d.rowCount,
    columnCount: d.columnCount,
    status: d.status,
    qualityScore: d.qualityScore,
    trustScore: d.trustScore,
    valueScore: d.valueScore,
    valueRecommendation: d.valueRecommendation,
    piiColumnCount,
    highestSensitivity,
    lastAccessedAt: access.lastAccessedAt,
    accessCount: access.accessCount,
    accessCount90d: access.accessCount90d,
    errorMessage: d.errorMessage,
    uploadedAt: d.uploadedAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toClassificationTagDTO(t: ClassificationTag): ClassificationTagDTO {
  return {
    id: t.id,
    category: t.category,
    sensitivity: t.sensitivity,
    source: t.source,
    confidence: t.confidence,
    overridden: t.overridden,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toColumnDTO(c: ColumnWithTag): ColumnDTO {
  return {
    id: c.id,
    name: c.name,
    position: c.position,
    dataType: c.dataType,
    missingCount: c.missingCount,
    missingPct: c.missingPct,
    distinctCount: c.distinctCount,
    completeness: c.completeness,
    validity: c.validity,
    sampleValues: (c.sampleValues as unknown[]) ?? [],
    classificationTag: c.classificationTag ? toClassificationTagDTO(c.classificationTag) : null,
  };
}

export function toQualityCheckDTO(q: QualityCheck): QualityCheckDTO {
  return {
    id: q.id,
    columnId: q.columnId,
    checkType: q.checkType,
    severity: q.severity,
    affectedCount: q.affectedCount,
    affectedPct: q.affectedPct,
    detail: q.detail,
    createdAt: q.createdAt.toISOString(),
  };
}
