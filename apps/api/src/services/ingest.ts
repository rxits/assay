// Ingestion pipeline (04 §2.2): validate -> create Dataset(PROCESSING) -> parse
// -> profile -> classify -> quality checks -> score -> persist Columns + tags + checks
// + scores + capped sampleRows -> READY. Empty/0-row/0-col/unparseable files are rejected
// up-front (4xx, no row). A fault *after* the row exists (e.g. a non-rectangular file) flips
// the dataset to FAILED at 201 with null scores (R1) — a broken dataset is a catalogued
// first-class citizen, never a 500. Classification/scoring/narrative run here (Phase 2B);
// the AI layer degrades to regex-only when ANTHROPIC_API_KEY is unset (07 §6, R8).
import type { Prisma } from "@prisma/client";
import type { DatasetSummary, FileType, PiiCategory, Sensitivity, TagSource } from "@assay/shared";
import { prisma } from "../lib/prisma";
import { parseFile, type ParsedFile } from "../lib/parsers";
import { profileDataset, type ProfiledColumn } from "../domain/profile";
import { classifyColumn } from "../domain/classification";
import { detectQualityChecks } from "../domain/quality";
import { scoreProfiledDataset } from "./scoring";
import { anthropic, classifyColumnAI, generateHealthNarrative } from "../lib/anthropic";
import { ApiHttpError } from "../lib/errors";
import { toDatasetSummary } from "./serialize";

const SAMPLE_ROWS_CAP = 50; // 00-SPEC §6 / 03 §6: capped preview, never the raw file

export interface IngestInput {
  buffer: Buffer;
  originalFilename: string;
  fileType: FileType;
  sizeBytes: number;
  name?: string | undefined;
}

interface DraftTag {
  position: number;
  category: PiiCategory;
  sensitivity: Sensitivity;
  confidence: number | null;
  source: TagSource;
}

export async function ingestDataset(input: IngestInput): Promise<DatasetSummary> {
  const { buffer, originalFilename, fileType, sizeBytes } = input;
  const name = input.name?.trim() || originalFilename;

  if (sizeBytes === 0 || buffer.length === 0) {
    throw new ApiHttpError(422, "empty_file", "Uploaded file is empty.");
  }

  // Parse before persisting so purely-bad files never leave a row behind.
  let parsed: ParsedFile;
  try {
    parsed = parseFile(buffer, fileType);
  } catch {
    throw new ApiHttpError(422, "invalid_file", "File could not be parsed as a tabular file.");
  }
  if (parsed.headers.length === 0) {
    throw new ApiHttpError(422, "empty_file", "File has no columns.");
  }
  if (parsed.rows.length === 0) {
    throw new ApiHttpError(422, "empty_file", "File has a header row but no data rows.");
  }

  const dataset = await prisma.dataset.create({
    data: {
      name,
      originalFilename,
      fileType,
      sizeBytes,
      rowCount: parsed.rows.length,
      columnCount: parsed.headers.length,
      status: "PROCESSING",
    },
  });

  try {
    if (parsed.ragged) {
      throw new Error(
        `File is not rectangular: a data row's field count does not match the ${parsed.headers.length}-column header.`,
      );
    }

    const profile = profileDataset(parsed.headers, parsed.rows);
    const sampleRows = buildSampleRows(parsed.headers, parsed.rows);

    // Classification (regex, refined by Claude for ambiguous columns only when a key is set).
    // Every column ends classified (incl. explicit NONE, 07 §9) → ClassificationCoverage 1.0.
    const tags = await classifyColumns(profile.columns);
    const checks = detectQualityChecks(profile);
    // No AccessEvents yet → Value is low/RETIRE by design (06 §8, R10); Phase 3 recomputes on read.
    const scored = scoreProfiledDataset(profile, true, [], new Date());
    const healthNarrative = await generateHealthNarrative(buildNarrativeSummary(name, profile, scored, tags));

    await prisma.$transaction(async (tx) => {
      await tx.column.createMany({
        data: profile.columns.map((c) => ({
          datasetId: dataset.id,
          name: c.name,
          position: c.position,
          dataType: c.dataType,
          missingCount: c.missingCount,
          missingPct: c.missingPct,
          distinctCount: c.distinctCount,
          completeness: c.completeness,
          validity: c.validity,
          sampleValues: c.sampleValues as Prisma.InputJsonValue,
        })),
      });

      // createMany returns no ids; map columnPosition -> Column.id for tags + checks.
      const created = await tx.column.findMany({
        where: { datasetId: dataset.id },
        select: { id: true, position: true },
      });
      const posToId = new Map(created.map((c) => [c.position, c.id]));

      await tx.classificationTag.createMany({
        data: tags.map((t) => ({
          columnId: posToId.get(t.position)!,
          category: t.category,
          sensitivity: t.sensitivity,
          source: t.source,
          confidence: t.confidence,
          overridden: false,
        })),
      });

      if (checks.length > 0) {
        await tx.qualityCheck.createMany({
          data: checks.map((ck) => ({
            datasetId: dataset.id,
            columnId: ck.columnPosition == null ? null : (posToId.get(ck.columnPosition) ?? null),
            checkType: ck.checkType,
            severity: ck.severity,
            affectedCount: ck.affectedCount,
            affectedPct: ck.affectedPct,
            detail: ck.detail,
          })),
        });
      }

      await tx.dataset.update({
        where: { id: dataset.id },
        data: {
          status: "READY",
          sampleRows: sampleRows as unknown as Prisma.InputJsonValue,
          qualityScore: scored.qualityScore,
          trustScore: scored.trustScore,
          valueScore: scored.valueScore,
          valueRecommendation: scored.valueRecommendation,
          scoreBreakdown: scored.scoreBreakdown as unknown as Prisma.InputJsonValue,
          healthNarrative,
        },
      });
    });

    const ready = await prisma.dataset.findUniqueOrThrow({
      where: { id: dataset.id },
      include: { columns: { include: { classificationTag: { select: { sensitivity: true } } } } },
    });
    return toDatasetSummary(ready, ready.columns);
  } catch (err) {
    // R1: a fault after the row exists → FAILED with null score columns (scores were never set).
    const failed = await prisma.dataset.update({
      where: { id: dataset.id },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "Ingestion failed.",
      },
    });
    return toDatasetSummary(failed);
  }
}

// Regex classification per column, refined by Claude Haiku only for genuinely-ambiguous
// columns AND only when a key is configured (07 §6.1). No key ⇒ pure regex (the tested default).
async function classifyColumns(columns: ProfiledColumn[]): Promise<DraftTag[]> {
  return Promise.all(
    columns.map(async (c): Promise<DraftTag> => {
      const r = classifyColumn({ header: c.name, sampleValues: c.sampleValues });
      if (r.needsAi && anthropic) {
        const ai = await classifyColumnAI(c.name, c.sampleValues);
        if (ai) {
          return { position: c.position, category: ai.category, sensitivity: ai.sensitivity, confidence: ai.confidence, source: "AUTO_AI" };
        }
      }
      return { position: c.position, category: r.category, sensitivity: r.sensitivity, confidence: r.confidence, source: r.source };
    }),
  );
}

// Compact, PII-free profile summary for the health narrative (07 §6.6). Never raw rows.
function buildNarrativeSummary(
  name: string,
  profile: ReturnType<typeof profileDataset>,
  scored: ReturnType<typeof scoreProfiledDataset>,
  tags: DraftTag[],
): string {
  const sensitive = tags.filter((t) => t.sensitivity !== "NONE");
  const cats = [...new Set(sensitive.map((t) => t.category))].join(", ");
  return (
    `${name} — ${profile.rowCount} rows × ${profile.columns.length} cols. ` +
    `Quality ${Math.round(scored.qualityScore)}, Trust ${Math.round(scored.trustScore)}, ` +
    `Value ${Math.round(scored.valueScore)} (${scored.valueRecommendation}). ` +
    `Duplicate rows: ${profile.duplicateRowCount}. ` +
    `Sensitive columns: ${sensitive.length}${cats ? ` (${cats})` : ""}.`
  );
}

function buildSampleRows(headers: string[], rows: (string | null)[][]): Record<string, unknown>[] {
  const keys = disambiguate(headers);
  return rows.slice(0, SAMPLE_ROWS_CAP).map((row) => {
    const obj: Record<string, unknown> = {};
    keys.forEach((key, i) => {
      obj[key] = row[i] ?? null;
    });
    return obj;
  });
}

// Object keys must be unique; duplicate/blank headers get positional suffixes so
// the preview keeps every column (the raw duplicate names live on Column.name).
function disambiguate(headers: string[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((h) => {
    const base = h.trim() === "" ? "column" : h;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}
