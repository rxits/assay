import { describe, it, expect } from "vitest";
import { inferColumnType, profileColumn, profileDataset } from "./profile";

// --- Type inference table (08 §3.3) --------------------------------------
describe("inferColumnType", () => {
  it.each([
    [["1", "2", "3"], "INTEGER"],
    [["1.5", "2.0"], "FLOAT"],
    [["true", "false"], "BOOLEAN"],
    [["2024-01-01"], "DATE"],
    [["2024-01-01T10:00:00Z"], "DATETIME"],
    [["ada@x.io", "bob"], "STRING"],
    [[], "UNKNOWN"],
    [[null, null], "UNKNOWN"],
    [["1", "x", "2"], "STRING"], // mixed -> dominant-type fallback to STRING
  ] as [(string | null)[], string][])("%o -> %s", (values, expected) => {
    expect(inferColumnType(values)).toBe(expected);
  });
});

// --- Per-column profiling -------------------------------------------------
describe("profileColumn", () => {
  it("tracks dominantTypeShare ≈0.67 for a mixed column (Consistency input)", () => {
    const p = profileColumn(["1", "x", "2"], 3);
    expect(p.dataType).toBe("STRING");
    expect(p.dominantTypeShare).toBeCloseTo(0.667, 2);
    expect(p.validity).toBe(1); // STRING is always valid (R9)
  });

  it("computes completeness, missing, distinct, and samples", () => {
    const p = profileColumn(["a", "b", null, "", "a"], 5);
    expect(p.missingCount).toBe(2); // null and ""
    expect(p.completeness).toBeCloseTo(0.6, 4);
    expect(p.missingPct).toBeCloseTo(0.4, 4);
    expect(p.distinctCount).toBe(2); // a, b
    expect(p.sampleValues).toEqual(["a", "b"]); // distinct, capped
  });

  it("commits to INTEGER above the threshold and drops validity for stragglers (R9)", () => {
    const vals = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "x"];
    const p = profileColumn(vals, 10);
    expect(p.dataType).toBe("INTEGER");
    expect(p.validity).toBeCloseTo(0.9, 4); // 9/10 match /^-?\d+$/
  });

  it("treats an all-null column as UNKNOWN with completeness 0 (valid low score, not null)", () => {
    const p = profileColumn([null, "", null], 3);
    expect(p.dataType).toBe("UNKNOWN");
    expect(p.completeness).toBe(0);
    expect(p.validity).toBe(1);
    expect(p.distinctCount).toBe(0);
    expect(p.sampleValues).toEqual([]);
  });

  it("caps sampleValues at 10 distinct values", () => {
    const vals = Array.from({ length: 30 }, (_, i) => String(i));
    expect(profileColumn(vals, 30).sampleValues).toHaveLength(10);
  });
});

// --- Dataset-level profiling ---------------------------------------------
describe("profileDataset", () => {
  it("profiles every column, counts duplicate rows, and flags duplicate headers", () => {
    const headers = ["email", "name", "name"];
    const rows = [
      ["ada@x.io", "Ada", "L"],
      ["grace@x.io", "Grace", "H"],
      ["ada@x.io", "Ada", "L"], // exact duplicate of row 0
    ];
    const p = profileDataset(headers, rows);
    expect(p.columns).toHaveLength(3);
    expect(p.columns[0]!.name).toBe("email");
    expect(p.duplicateRowCount).toBe(1);
    expect(p.structuralIssues).toContain("DUPLICATE_HEADER");
  });

  it("flags a blank header", () => {
    const p = profileDataset(["a", "", "c"], [["1", "2", "3"]]);
    expect(p.structuralIssues).toContain("BLANK_HEADER");
  });
});
