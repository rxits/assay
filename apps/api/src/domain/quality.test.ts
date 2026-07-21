import { describe, it, expect } from "vitest";
import { detectQualityChecks } from "./quality";
import { profileDataset } from "./profile";

// Build a single-column dataset with `present` distinct values then `total-present` nulls.
const missingCol = (present: number, total: number) =>
  profileDataset(
    ["a"],
    Array.from({ length: total }, (_, i) => [i < present ? String(i) : null]),
  );

const find = (checks: ReturnType<typeof detectQualityChecks>, t: string) => checks.find((c) => c.checkType === t);

describe("detectQualityChecks — 08 §3.4", () => {
  it("grades MISSING_VALUES severity by threshold (≥0.5 ERROR, ≥0.2 WARNING, >0 INFO)", () => {
    expect(find(detectQualityChecks(missingCol(4, 10)), "MISSING_VALUES")?.severity).toBe("ERROR"); // 60%
    expect(find(detectQualityChecks(missingCol(7, 10)), "MISSING_VALUES")?.severity).toBe("WARNING"); // 30%
    expect(find(detectQualityChecks(missingCol(9, 10)), "MISSING_VALUES")?.severity).toBe("INFO"); // 10%
  });

  it("reports affectedCount / affectedPct for missing values", () => {
    const m = find(detectQualityChecks(missingCol(7, 10)), "MISSING_VALUES");
    expect(m?.affectedCount).toBe(3);
    expect(m?.affectedPct).toBeCloseTo(0.3, 4);
    expect(m?.columnName).toBe("a");
  });

  it("EMPTY_COLUMN subsumes MISSING_VALUES for an all-null column", () => {
    const p = profileDataset(["a", "b"], [["1", null], ["2", null], ["3", null]]);
    const checks = detectQualityChecks(p);
    expect(find(checks, "EMPTY_COLUMN")?.columnName).toBe("b");
    expect(checks.find((c) => c.checkType === "MISSING_VALUES" && c.columnName === "b")).toBeUndefined();
  });

  it("flags INVALID_VALUES for type stragglers (WARNING)", () => {
    const rows = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "x"].map((v) => [v]);
    const inv = find(detectQualityChecks(profileDataset(["n"], rows)), "INVALID_VALUES");
    expect(inv?.severity).toBe("WARNING");
    expect(inv?.affectedCount).toBe(1); // 9 ints match, "x" does not
  });

  it("flags TYPE_MISMATCH for a mixed column, without INVALID_VALUES (STRING is always valid)", () => {
    const checks = detectQualityChecks(profileDataset(["m"], [["1"], ["x"], ["2"]]));
    expect(find(checks, "TYPE_MISMATCH")?.columnName).toBe("m");
    expect(find(checks, "INVALID_VALUES")).toBeUndefined();
  });

  it("flags DUPLICATE_ROWS (dataset-level, WARNING) and DUPLICATE_HEADER (ERROR)", () => {
    const p = profileDataset(["id", "name", "name"], [["1", "a", "b"], ["1", "a", "b"]]);
    const checks = detectQualityChecks(p);
    const dup = find(checks, "DUPLICATE_ROWS");
    expect(dup?.severity).toBe("WARNING");
    expect(dup?.columnPosition).toBeNull();
    expect(dup?.affectedCount).toBe(1);
    expect(dup?.affectedPct).toBeCloseTo(0.5, 4);
    expect(find(checks, "DUPLICATE_HEADER")?.severity).toBe("ERROR");
    expect(find(checks, "DUPLICATE_HEADER")?.affectedCount).toBe(2); // both "name" columns
  });

  it("emits no checks for a clean dataset", () => {
    const p = profileDataset(["a", "b"], [["1", "x"], ["2", "y"], ["3", "z"]]);
    expect(detectQualityChecks(p)).toEqual([]);
  });
});
