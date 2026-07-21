import { describe, it, expect } from "vitest";
import {
  computeQuality,
  computeTrust,
  computeValue,
  recommend,
  scoreDataset,
  unit,
  config,
  type DatasetProfile,
  type ColumnProfile,
  type AccessEvent,
} from "./scoring";

// --- Fixtures (06 §4/§5 worked example — the tests of record, R5) ---------
const col = (o: Partial<ColumnProfile>): ColumnProfile => ({
  name: "c",
  position: 0,
  dataType: "STRING",
  rowCount: 100,
  nonNullCount: 100,
  typeMatchCount: 100,
  dominantTypeShare: 1,
  distinctCount: 100,
  isClassified: true,
  ...o,
});

// customers.csv — 100 rows, 4 cols, 3 duplicate rows; 3 of 4 classified.
// Quality 97.06, Trust 91.90 (06 §4/§5).
const customersProfile: DatasetProfile = {
  rowCount: 100,
  duplicateRowCount: 3,
  structuralIssues: [],
  columns: [
    col({ name: "c1", position: 0, nonNullCount: 100, typeMatchCount: 100, dominantTypeShare: 1.0, isClassified: true }),
    col({ name: "c2", position: 1, dataType: "INTEGER", nonNullCount: 90, typeMatchCount: 88, dominantTypeShare: 0.98, isClassified: true }),
    col({ name: "c3", position: 2, nonNullCount: 100, typeMatchCount: 100, dominantTypeShare: 1.0, isClassified: true }),
    col({ name: "c4", position: 3, dataType: "FLOAT", nonNullCount: 96, typeMatchCount: 90, dominantTypeShare: 0.95, isClassified: false }),
  ],
};

const emptyProfile: DatasetProfile = { rowCount: 0, duplicateRowCount: 0, columns: [], structuralIssues: [] };

const NOW = new Date("2026-01-01T00:00:00.000Z");
const daysAgo = (n: number): AccessEvent => ({ occurredAt: new Date(NOW.getTime() - n * 86_400_000) });

// cooling: accesses90d=8, last30=1, prev30=5, daysSinceLast=24 → Value 42.87 OPTIMIZE (06 §6).
const coolingEvents: AccessEvent[] = [
  daysAgo(24),
  daysAgo(35), daysAgo(40), daysAgo(45), daysAgo(50), daysAgo(55),
  daysAgo(65), daysAgo(70),
];

describe("computeQuality (06 §4)", () => {
  it("customers.csv → 97.06 with the documented components", () => {
    const q = computeQuality(customersProfile);
    expect(q.components.completeness.value).toBeCloseTo(0.965, 4);
    expect(q.components.validity.value).toBeCloseTo(0.97882, 4);
    expect(q.components.uniqueness.value).toBeCloseTo(0.97, 4);
    expect(q.score).toBeCloseTo(97.06, 2);
  });

  it("contribution invariant holds (100·weight·value)", () => {
    const q = computeQuality(customersProfile);
    for (const c of Object.values(q.components)) expect(c.contribution).toBeCloseTo(100 * c.weight * c.value, 10);
  });

  it("empty dataset → 0, never NaN (R1: total pure fn)", () => {
    const q = computeQuality(emptyProfile);
    expect(q.score).toBe(0);
    expect(Number.isNaN(q.score)).toBe(false);
  });
});

describe("computeTrust (06 §5) — Trust ⊇ Quality", () => {
  it("customers.csv → 91.90, landing below Quality via incomplete coverage", () => {
    const q = computeQuality(customersProfile);
    const t = computeTrust(q, customersProfile);
    expect(t.components.consistency.value).toBeCloseTo(0.9825, 4);
    expect(t.components.classificationCoverage.value).toBeCloseTo(0.75, 4);
    expect(t.score).toBeCloseTo(91.9, 2);
    expect(t.score).toBeLessThan(q.score); // the ⊇ relationship, asserted
  });

  it("penalizes Consistency by 0.05 per distinct structural issue (R3)", () => {
    const profile: DatasetProfile = { ...customersProfile, structuralIssues: ["DUPLICATE_HEADER", "RAGGED_ROWS"] };
    const t = computeTrust(computeQuality(profile), profile);
    expect(t.consistencyDetail.structuralPenalty).toBeCloseTo(0.1, 4); // 2 × 0.05
    expect(t.components.consistency.value).toBeCloseTo(0.9825 * 0.9, 4);
  });

  it("empty dataset → Trust 0, never NaN", () => {
    const t = computeTrust(computeQuality(emptyProfile), emptyProfile);
    expect(t.score).toBe(0);
    expect(Number.isNaN(t.score)).toBe(false);
  });
});

describe("computeValue + recommend (06 §6/§7) — Value ⟂ Quality", () => {
  it("cooling dataset → 42.87 OPTIMIZE", () => {
    const v = computeValue(coolingEvents, NOW);
    expect(v.inputs).toMatchObject({ accesses90d: 8, accessesLast30: 1, accessesPrev30: 5, daysSinceLastAccess: 24 });
    expect(v.components.frequency.value).toBeCloseTo(0.558829, 5);
    expect(v.components.recency.value).toBeCloseTo(0.449329, 5);
    expect(v.components.trend.value).toBeCloseTo(0.1, 5);
    expect(v.score).toBeCloseTo(42.87, 2);
    expect(v.recommendation).toBe("OPTIMIZE");
  });

  it("0 access events → Value 10.00, RETIRE (06 §8)", () => {
    const v = computeValue([], NOW);
    expect(v.components.frequency.value).toBe(0);
    expect(v.components.recency.value).toBe(0);
    expect(v.inputs.daysSinceLastAccess).toBeNull();
    expect(v.score).toBeCloseTo(10.0, 2);
    expect(v.recommendation).toBe("RETIRE");
  });

  // §7 decision table, driven directly.
  it.each([
    { score: 91.91, a90: 40, trend: 0.83, rec: "KEEP" },
    { score: 42.87, a90: 8, trend: 0.1, rec: "OPTIMIZE" },
    { score: 27.65, a90: 4, trend: 0.0, rec: "ARCHIVE" },
    { score: 10.0, a90: 0, trend: 0.5, rec: "RETIRE" },
  ])("recommend($score, $a90, $trend) → $rec", ({ score, a90, trend, rec }) => {
    expect(recommend(score, a90, unit(trend))).toBe(rec);
  });
});

describe("config self-check", () => {
  it("each weight set sums to 1", () => {
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    for (const w of [config.quality, config.trust, config.value]) expect(sum(w)).toBeCloseTo(1, 10);
  });
});

describe("scoreDataset", () => {
  it("bundles Quality/Trust/Value + a breakdown wired to the same results", () => {
    const r = scoreDataset(customersProfile, coolingEvents, NOW);
    expect(r.quality.score).toBeCloseTo(97.06, 2);
    expect(r.trust.score).toBeCloseTo(91.9, 2);
    expect(r.value.score).toBeCloseTo(42.87, 2);
    expect(r.breakdown.quality).toBe(r.quality);
    expect(r.breakdown.value).toBe(r.value);
  });
});
