// GET /api/overview (R1.2) — catalog-wide aggregate for the dashboard home,
// against the real Express app + Prisma (truncated per test). Proves the roll-up
// counts status, averages only scored datasets, distributes sensitivity + value
// recommendation across every enum key, sums rows/cols, and surfaces the FAILED /
// RETIRE datasets under needsAttention.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";

const CSV_CUSTOMERS = "email,age\nada@x.io,36\ngrace@x.io,45"; // email → EMAIL/HIGH, age → NONE
const CSV_ORDERS = "sku,qty\nA-1,10\nB-2,20"; // no PII → both NONE
const CSV_BROKEN = "a,b,c\n1,2,3,4\n5,6"; // ragged rows → graceful FAILED

const app = createApp();

async function upload(csv: string, filename: string) {
  const res = await request(app).post("/api/datasets").attach("file", Buffer.from(csv), filename).expect(201);
  return res.body.data as { id: string; rowCount: number; columnCount: number; status: string };
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "ClassificationTag","QualityCheck","AccessEvent","ScoreSnapshot","Column","Dataset" RESTART IDENTITY CASCADE',
  );
});

describe("GET /api/overview — dashboard aggregate", () => {
  it("rolls up status, averages, distributions, and attention lists", async () => {
    const customers = await upload(CSV_CUSTOMERS, "customers.csv");
    const orders = await upload(CSV_ORDERS, "orders.csv");
    const broken = await upload(CSV_BROKEN, "broken.csv");
    expect(customers.status).toBe("READY");
    expect(broken.status).toBe("FAILED");

    const res = await request(app).get("/api/overview").expect(200);
    const o = res.body.data;

    // Status counts.
    expect(o.totalDatasets).toBe(3);
    expect(o.ready).toBe(2);
    expect(o.failed).toBe(1);
    expect(o.processing).toBe(0);

    // Averages reflect only the scored (READY) datasets.
    expect(o.avgQuality).toBeGreaterThan(0);
    expect(o.avgTrust).toBeGreaterThan(0);
    // Rounded to one decimal.
    expect(o.avgQuality).toBe(Math.round(o.avgQuality * 10) / 10);

    // Sums span every dataset's stored counts.
    expect(o.totalRows).toBe(customers.rowCount + orders.rowCount + broken.rowCount);
    expect(o.totalColumns).toBe(customers.columnCount + orders.columnCount + broken.columnCount);

    // Sensitivity distribution: email is the only PII column; age/sku/qty resolve NONE.
    expect(o.sensitivityDistribution).toEqual({ NONE: 3, LOW: 0, MEDIUM: 0, HIGH: 1 });
    expect(o.piiColumnCount).toBe(1);

    // Every recommendation key is present; the two scored datasets each carry one.
    expect(Object.keys(o.recommendationDistribution).sort()).toEqual(["ARCHIVE", "KEEP", "OPTIMIZE", "RETIRE"]);
    const recTotal = Object.values(o.recommendationDistribution as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(recTotal).toBe(2);

    // Recent uploads (newest-first, ≤5) — all three, with the quality score carried.
    expect(o.recentUploads).toHaveLength(3);
    expect(o.recentUploads.map((r: { name: string }) => r.name).sort()).toEqual([
      "broken.csv",
      "customers.csv",
      "orders.csv",
    ]);
    const brokenRecent = o.recentUploads.find((r: { id: string }) => r.id === broken.id);
    expect(brokenRecent.qualityScore).toBeNull();

    // Needs attention includes the FAILED dataset; every item is FAILED or RETIRE.
    expect(o.needsAttention.some((a: { status: string }) => a.status === "FAILED")).toBe(true);
    expect(
      o.needsAttention.every(
        (a: { status: string; valueRecommendation: string | null }) =>
          a.status === "FAILED" || a.valueRecommendation === "RETIRE",
      ),
    ).toBe(true);
  });

  it("returns a zeroed overview for an empty catalog", async () => {
    const res = await request(app).get("/api/overview").expect(200);
    const o = res.body.data;
    expect(o.totalDatasets).toBe(0);
    expect(o.avgQuality).toBe(0);
    expect(o.avgValue).toBe(0);
    expect(o.totalRows).toBe(0);
    expect(o.sensitivityDistribution).toEqual({ NONE: 0, LOW: 0, MEDIUM: 0, HIGH: 0 });
    expect(o.recommendationDistribution).toEqual({ KEEP: 0, OPTIMIZE: 0, ARCHIVE: 0, RETIRE: 0 });
    expect(o.recentUploads).toEqual([]);
    expect(o.needsAttention).toEqual([]);
  });
});
