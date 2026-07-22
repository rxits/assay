// Pure quality-check detection (08 §3.4). Turns a DatasetProfile into the
// QualityCheck rows persisted per 00-SPEC §6. No I/O — the service assigns DB
// ids/columnIds (mapping columnPosition → Column.id) and persists in Phase 2B.
import type { QualityCheckType, Severity } from "@assay/shared";
import type { DatasetProfile } from "./profile";

/** A detected check, minus the DB-assigned id/createdAt/columnId (see columnPosition). */
export interface QualityCheckResult {
  columnPosition: number | null; // null = dataset-level (e.g. duplicate rows)
  columnName: string | null;
  checkType: QualityCheckType;
  severity: Severity;
  affectedCount: number;
  affectedPct: number; // 0–1
  detail: string;
}

// Missing-value severity by share (08 §3.4): ≥0.5 ERROR, ≥0.2 WARNING, >0 INFO.
const missingSeverity = (pct: number): Severity =>
  pct >= 0.5 ? "ERROR" : pct >= 0.2 ? "WARNING" : "INFO";

// Deliberate simplification: threshold picked to match profile.ts's TYPE_COMMIT_THRESHOLD (0.8) —
// below it a column stayed STRING, so a strong type conflict is WARNING, minor is INFO.
const TYPE_MISMATCH_WARN = 0.8;

const pct1 = (x: number) => (x * 100).toFixed(1);

/** Detect all quality checks for a profiled dataset (08 §3.4). */
export function detectQualityChecks(profile: DatasetProfile): QualityCheckResult[] {
  const { rowCount, columns, duplicateRowCount, structuralIssues } = profile;
  const checks: QualityCheckResult[] = [];

  for (const c of columns) {
    // EMPTY_COLUMN subsumes MISSING_VALUES for an all-null column (one signal, not two).
    if (c.completeness === 0) {
      checks.push({
        columnPosition: c.position,
        columnName: c.name,
        checkType: "EMPTY_COLUMN",
        severity: "WARNING",
        affectedCount: c.missingCount,
        affectedPct: c.missingPct,
        detail: `Column "${c.name}" is entirely empty.`,
      });
    } else if (c.missingPct > 0) {
      checks.push({
        columnPosition: c.position,
        columnName: c.name,
        checkType: "MISSING_VALUES",
        severity: missingSeverity(c.missingPct),
        affectedCount: c.missingCount,
        affectedPct: c.missingPct,
        detail: `${c.missingCount} missing value(s) (${pct1(c.missingPct)}%) in "${c.name}".`,
      });
    }

    // INVALID_VALUES: present values that don't match the committed type (validity < 1).
    if (c.validity < 1) {
      const invalid = c.nonNullCount - c.typeMatchCount;
      checks.push({
        columnPosition: c.position,
        columnName: c.name,
        checkType: "INVALID_VALUES",
        severity: "WARNING",
        affectedCount: invalid,
        affectedPct: c.nonNullCount === 0 ? 0 : invalid / c.nonNullCount,
        detail: `${invalid} value(s) in "${c.name}" do not match inferred type ${c.dataType}.`,
      });
    }

    // TYPE_MISMATCH: the column mixes atomic types (dominant type < 100% of values).
    if (c.dominantTypeShare < 1) {
      checks.push({
        columnPosition: c.position,
        columnName: c.name,
        checkType: "TYPE_MISMATCH",
        severity: c.dominantTypeShare < TYPE_MISMATCH_WARN ? "WARNING" : "INFO",
        affectedCount: Math.round((1 - c.dominantTypeShare) * c.nonNullCount),
        affectedPct: 1 - c.dominantTypeShare,
        detail: `Mixed types in "${c.name}"; dominant type covers ${(c.dominantTypeShare * 100).toFixed(0)}%.`,
      });
    }
  }

  if (duplicateRowCount > 0) {
    checks.push({
      columnPosition: null,
      columnName: null,
      checkType: "DUPLICATE_ROWS",
      severity: "WARNING",
      affectedCount: duplicateRowCount,
      affectedPct: rowCount > 0 ? duplicateRowCount / rowCount : 0,
      detail: `${duplicateRowCount} duplicate row(s) detected.`,
    });
  }

  // BLANK_HEADER has no QualityCheckType (00-SPEC §6) — it only feeds the Consistency
  // penalty. Only DUPLICATE_HEADER surfaces here.
  if (structuralIssues.includes("DUPLICATE_HEADER")) {
    const lowered = columns.map((c) => c.name.trim().toLowerCase());
    const affected = lowered.filter((n, i) => lowered.indexOf(n) !== i || lowered.lastIndexOf(n) !== i).length;
    checks.push({
      columnPosition: null,
      columnName: null,
      checkType: "DUPLICATE_HEADER",
      severity: "ERROR",
      affectedCount: affected,
      affectedPct: columns.length > 0 ? affected / columns.length : 0,
      detail: "Duplicate column header(s) detected.",
    });
  }

  return checks;
}
