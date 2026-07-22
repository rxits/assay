// Ingestion pipeline (04 §2.2): validate -> create Dataset(PROCESSING) -> parse
// -> profile -> classify -> quality checks -> score -> persist Columns + tags + checks
// + scores + capped sampleRows -> READY. Empty/0-row/0-col/unparseable files are rejected
// up-front (4xx, no row). A fault *after* the row exists (e.g. a non-rectangular file) flips
// the dataset to FAILED at 201 with null scores (R1) — a broken dataset is a catalogued
// first-class citizen, never a 500. Classification/scoring/narrative run here (Phase 2B);
// the AI layer degrades to regex-only when GROQ_API_KEY is unset (07 §6, R8).
import type { Prisma } from "@prisma/client";
import type { DatasetSummary, FileType, PiiCategory, Sensitivity, TagSource } from "@assay/shared";
import { prisma } from "../lib/prisma";
import { INGEST } from "../lib/config";
import { ParseError, parseFile, type ParsedFile } from "../lib/parsers";
import { profileDataset, type ProfiledColumn } from "../domain/profile";
import { classifyColumn, type ClassifyConfig } from "../domain/classification";
import { detectQualityChecks } from "../domain/quality";
import { scoreProfiledDataset } from "./scoring";
import { classifyColumnAI, generateHealthNarrative, llm } from "../lib/llm";
import { ApiHttpError } from "../lib/errors";
import { getEffectiveSettings, toClassifyConfig, toScoringConfig } from "./settings";
import { toDatasetSummary } from "./serialize";

/**
 * A failure whose message we wrote ourselves, and may therefore show to the world.
 *
 * `Dataset.errorMessage` is rendered on the public catalog, so echoing `err.message` from an
 * arbitrary throw published whatever the failing library said — a NUL byte in a cell surfaced
 * a Prisma error complete with absolute repo paths and source lines.
 */
export class IngestFailure extends Error {
  override readonly name = "IngestFailure";
}

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
  } catch (err) {
    // A ParseError carries a reason the uploader can act on ("unterminated quote near line
    // 5"); anything else is an internal fault whose message is not ours to publish.
    throw new ApiHttpError(
      422,
      "invalid_file",
      err instanceof ParseError ? err.message : "File could not be parsed as a tabular file."
    );
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
      throw new IngestFailure(
        `File is not rectangular: a data row's field count does not match the ${parsed.headers.length}-column header.`,
      );
    }

    const profile = profileDataset(parsed.headers, parsed.rows);
    const sampleRows = buildSampleRows(parsed.headers, parsed.rows);
    // Operator overrides (R3) — the pure engines still default to the static config; the
    // effective settings are passed in, never patched onto the module.
    const settings = await getEffectiveSettings();

    // Classification (regex, refined by the LLM for ambiguous columns only when a key is set).
    // Every column ends classified (incl. explicit NONE, 07 §9) → ClassificationCoverage 1.0.
    const tags = await classifyColumns(profile.columns, toClassifyConfig(settings));
    const checks = detectQualityChecks(profile);
    // No AccessEvents yet → Value is low/RETIRE by design (06 §8, R10); Phase 3 recomputes on read.
    const scored = scoreProfiledDataset(profile, true, [], new Date(), toScoringConfig(settings));
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
        // This string is rendered on a public dashboard. Only messages we authored are safe
        // to show — a raw driver error carries absolute repo paths, source lines and SQL.
        errorMessage:
          err instanceof IngestFailure ? err.message : "Ingestion failed: the file could not be profiled.",
      },
    });
    return toDatasetSummary(failed);
  }
}

// Regex classification per column, refined by the Groq LLM only for genuinely-ambiguous
// columns AND only when a key is configured (07 §6.1). No key ⇒ pure regex (the tested default).
async function classifyColumns(columns: ProfiledColumn[], cfg: ClassifyConfig): Promise<DraftTag[]> {
  return Promise.all(
    columns.map(async (c): Promise<DraftTag> => {
      const r = classifyColumn({ header: c.name, sampleValues: c.sampleValues }, cfg);
      if (r.needsAi && llm) {
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
  return rows.slice(0, INGEST.sampleRowsCap).map((row) => {
    const obj: Record<string, unknown> = {};
    keys.forEach((key, i) => {
      const cell = row[i] ?? null;
      obj[key] = cell === null ? null : truncate(cell);
    });
    return obj;
  });
}

// The INGEST caps bound how MANY samples are kept, never how LONG each one is — so a single
// 2 MB cell was persisted twice and turned a two-row dataset into a 4 MB detail response.
// Samples exist to show a human what the data looks like; 256 characters does that.
const MAX_SAMPLE_CHARS = 256;
export const truncate = (s: string): string =>
  s.length <= MAX_SAMPLE_CHARS ? s : `${s.slice(0, MAX_SAMPLE_CHARS - 1)}…`;

// Object keys must be unique; duplicate/blank headers get positional suffixes so
// the preview keeps every column (the raw duplicate names live on Column.name).
function disambiguate(headers: string[]): string[] {
  // Counting occurrences per base name is not enough: headers `a, a_2, a` produced keys
  // `a, a_2, a_2`, so the third column silently overwrote the second and the preview showed
  // one column's values under another's name. Track the names actually taken and keep
  // incrementing until the candidate is genuinely free.
  const used = new Set<string>();
  return headers.map((h) => {
    const base = truncate(h.trim() === "" ? "column" : h);
    let key = base;
    let n = 1;
    while (used.has(key)) key = `${base}_${++n}`;
    used.add(key);
    return key;
  });
}
