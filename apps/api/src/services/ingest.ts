// Ingestion pipeline (04 §2.2): validate -> create Dataset(PROCESSING) -> parse
// -> profile -> persist Columns + capped sampleRows -> READY. Empty/0-row/0-col/
// unparseable files are rejected up-front (4xx, no row). A fault *after* the row
// exists (e.g. a non-rectangular file) flips the dataset to FAILED at 201 — a
// broken dataset is a catalogued first-class citizen, never a 500.
// Classification, quality checks, and scoring are Phase 2 — not run here.
import type { Prisma } from "@prisma/client";
import type { DatasetSummary, FileType } from "@assay/shared";
import { prisma } from "../lib/prisma";
import { parseFile, type ParsedFile } from "../lib/parsers";
import { profileDataset } from "../domain/profile";
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

    await prisma.$transaction([
      prisma.column.createMany({
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
      }),
      prisma.dataset.update({
        where: { id: dataset.id },
        data: { status: "READY", sampleRows: sampleRows as unknown as Prisma.InputJsonValue },
      }),
    ]);

    return toDatasetSummary(await prisma.dataset.findUniqueOrThrow({ where: { id: dataset.id } }));
  } catch (err) {
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
