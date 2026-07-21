// Prisma row -> wire DTO mappers. Shared by ingest (POST response) and catalog
// (list/detail). Phase 1 leaves scores/tags/usage empty; the derived PII/access
// fields are stubbed (0/null) until Phase 2/3 wire classification and tracking.
import type { Column, Dataset } from "@prisma/client";
import type { ColumnDTO, DatasetSummary } from "@assay/shared";

export function toDatasetSummary(d: Dataset): DatasetSummary {
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
    piiColumnCount: 0, // Phase 2: count of columns with sensitivity > NONE
    highestSensitivity: null, // Phase 2: max column sensitivity
    lastAccessedAt: null, // Phase 3: max AccessEvent.occurredAt
    errorMessage: d.errorMessage,
    uploadedAt: d.uploadedAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toColumnDTO(c: Column): ColumnDTO {
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
    classificationTag: null, // Phase 2
  };
}
