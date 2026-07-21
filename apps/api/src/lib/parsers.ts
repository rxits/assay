// Buffer -> tabular parsers. CSV via PapaParse, XLSX via SheetJS (first sheet
// only, R7). Both normalize to { headers, rows } with rows null-padded/truncated
// to the header width (04 §3: short rows null-padded, extra fields dropped) and
// duplicate headers preserved by position. `ragged` reports whether any raw data
// row's field count differed from the header — the ingest layer treats that as a
// non-rectangular failure (04 §2.2 FAILED example).
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { FileType } from "@assay/shared";

export interface ParsedFile {
  headers: string[];
  rows: (string | null)[][];
  ragged: boolean;
}

function normalize(matrix: unknown[][]): ParsedFile {
  const rawHeader = matrix[0] ?? [];
  const headers = rawHeader.map((h) => (h == null ? "" : String(h)));
  const width = headers.length;

  let ragged = false;
  const rows: (string | null)[][] = [];
  for (let i = 1; i < matrix.length; i++) {
    const raw = matrix[i] ?? [];
    if (raw.length !== width) ragged = true;
    const row: (string | null)[] = [];
    for (let c = 0; c < width; c++) {
      const cell = raw[c];
      row.push(cell == null ? null : String(cell)); // short rows -> null, extra dropped
    }
    rows.push(row);
  }
  return { headers, rows, ragged };
}

export function parseCsv(buffer: Buffer): ParsedFile {
  const text = buffer.toString("utf8").replace(/^﻿/, ""); // strip BOM
  const result = Papa.parse<unknown[]>(text, { skipEmptyLines: "greedy" });
  return normalize(result.data);
}

export function parseXlsx(buffer: Buffer): ParsedFile {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const firstSheet = wb.SheetNames[0]; // R7: first sheet only
  if (!firstSheet) return { headers: [], rows: [], ragged: false };
  const ws = wb.Sheets[firstSheet]!;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: false, // formatted display strings (dates -> text), never raw serials
  });
  return normalize(matrix);
}

export function parseFile(buffer: Buffer, fileType: FileType): ParsedFile {
  return fileType === "XLSX" ? parseXlsx(buffer) : parseCsv(buffer);
}
