// Catalog read endpoints (04 §2.3–2.4) against real Prisma. Phase 2B: detail
// returns columns with resolved tags, a persisted scoreBreakdown, quality checks,
// and (AI disabled locally) a null healthNarrative; usage stays an empty Phase-3 series.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";

const CSV_A = "email,age\nada@x.io,36\ngrace@x.io,45";
const CSV_B = "sku,qty\nA-1,10\nB-2,20";

const app = createApp();

async function upload(csv: string, filename: string): Promise<string> {
  const res = await request(app).post("/api/datasets").attach("file", Buffer.from(csv), filename).expect(201);
  return res.body.data.id;
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

describe("GET /api/datasets — catalog list", () => {
  it("lists uploaded datasets with pagination meta", async () => {
    await upload(CSV_A, "customers.csv");
    await upload(CSV_B, "orders.csv");

    const res = await request(app).get("/api/datasets").expect(200);
    expect(res.body.meta).toMatchObject({ total: 2, limit: 20, offset: 0, count: 2 });
    expect(res.body.data.map((d: { name: string }) => d.name).sort()).toEqual(["customers.csv", "orders.csv"]);
  });

  it("honors limit/offset", async () => {
    await upload(CSV_A, "customers.csv");
    await upload(CSV_B, "orders.csv");
    const res = await request(app).get("/api/datasets?limit=1&offset=0").expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ total: 2, limit: 1, count: 1 });
  });

  it("rejects an out-of-range limit and an unknown sort with 422 validation_error", async () => {
    await request(app).get("/api/datasets?limit=500").expect(422);
    const res = await request(app).get("/api/datasets?sort=bogus").expect(422);
    expect(res.body.error.code).toBe("validation_error");
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it("returns an empty catalog cleanly", async () => {
    const res = await request(app).get("/api/datasets").expect(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });
});

describe("GET /api/datasets/:id — detail", () => {
  it("returns columns with resolved tags, a score breakdown, and quality checks", async () => {
    const id = await upload(CSV_A, "customers.csv");
    const res = await request(app).get(`/api/datasets/${id}`).expect(200);
    const d = res.body.data;

    expect(d.columns.map((c: { name: string }) => c.name)).toEqual(["email", "age"]);
    expect(d.columns.find((c: { name: string }) => c.name === "email").classificationTag.category).toBe("EMAIL");
    expect(d.columns.find((c: { name: string }) => c.name === "age").dataType).toBe("INTEGER");
    // Clean 2-row dataset → no quality findings, but the shape is populated, not stubbed.
    expect(Array.isArray(d.qualityChecks)).toBe(true);
    expect(d.scoreBreakdown.quality.score).toBeCloseTo(100, 1);
    expect(d.scoreBreakdown.trust.inputs.classificationCoverage).toBe(1);
    expect(d.healthNarrative).toBeNull(); // AI disabled locally
    expect(d.usage.series).toEqual([]);
    expect(d.usage.summary.lastAccessedAt).toBeNull();
    expect(d.sampleRows).toHaveLength(2);
  });

  it("404s for an unknown id", async () => {
    const res = await request(app).get("/api/datasets/does-not-exist").expect(404);
    expect(res.body.error.code).toBe("dataset_not_found");
  });
});
