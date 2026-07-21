// Manual override (04 §2.5 / 07 §8) against the real Express app + Prisma. A tag edit is
// MANUAL/overridden with no confidence, and recomputes ClassificationCoverage → Trust while
// leaving Quality and Value untouched. To make Trust *move* we open a coverage gap first
// (delete one auto-tag), since ingest otherwise classifies every column (coverage already 1.0).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";

const sample = (name: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`../../../../samples/${name}`, import.meta.url)));

const app = createApp();

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

async function uploadCustomers(): Promise<{ id: string; qualityScore: number; trustScore: number; valueScore: number }> {
  const res = await request(app)
    .post("/api/datasets")
    .attach("file", sample("customers.csv"), "customers.csv")
    .expect(201);
  return res.body.data;
}

const columnId = (datasetId: string, name: string) =>
  prisma.column.findFirstOrThrow({ where: { datasetId, name } }).then((c) => c.id);

describe("PATCH /api/datasets/:id/columns/:columnId/classification", () => {
  it("flips a tag to MANUAL and moves Trust via coverage, leaving Quality/Value unchanged", async () => {
    const ds = await uploadCustomers();
    // Open a coverage gap: drop country's auto-tag so coverage is < 1.0 during recompute.
    const countryId = await columnId(ds.id, "country");
    await prisma.classificationTag.deleteMany({ where: { columnId: countryId } });

    // Override a still-tagged column → recompute sees coverage 3/4 → Trust drops below the
    // ingest value (which was computed at full coverage).
    const emailId = await columnId(ds.id, "email");
    const patched = (
      await request(app)
        .patch(`/api/datasets/${ds.id}/columns/${emailId}/classification`)
        .send({ category: "EMAIL" })
        .expect(200)
    ).body.data;

    expect(patched.column.classificationTag.source).toBe("MANUAL");
    expect(patched.column.classificationTag.overridden).toBe(true);
    expect(patched.column.classificationTag.confidence).toBeNull();
    expect(patched.column.classificationTag.sensitivity).toBe("HIGH"); // default for EMAIL

    // Trust moved; Quality and Value are untouched.
    expect(patched.dataset.trustScore).toBeLessThan(ds.trustScore);
    expect(patched.dataset.qualityScore).toBeCloseTo(ds.qualityScore, 5);
    expect(patched.dataset.valueScore).toBeCloseTo(ds.valueScore, 5);
    expect(patched.dataset.scoreBreakdown.trust.inputs.classificationCoverage).toBeCloseTo(0.75, 5);

    // Classifying the previously-untagged column restores coverage → Trust rises back.
    const restored = (
      await request(app)
        .patch(`/api/datasets/${ds.id}/columns/${countryId}/classification`)
        .send({ category: "NONE" })
        .expect(200)
    ).body.data;
    expect(restored.dataset.scoreBreakdown.trust.inputs.classificationCoverage).toBe(1);
    expect(restored.dataset.trustScore).toBeGreaterThan(patched.dataset.trustScore);
    expect(restored.dataset.qualityScore).toBeCloseTo(ds.qualityScore, 5);
  });

  it("honors an explicit sensitivity over the category default", async () => {
    const ds = await uploadCustomers();
    const emailId = await columnId(ds.id, "email");
    const res = await request(app)
      .patch(`/api/datasets/${ds.id}/columns/${emailId}/classification`)
      .send({ category: "EMAIL", sensitivity: "LOW" })
      .expect(200);
    expect(res.body.data.column.classificationTag.sensitivity).toBe("LOW");
  });

  it("404s when the column is not under the dataset, and 422s on an invalid category", async () => {
    const ds = await uploadCustomers();
    const emailId = await columnId(ds.id, "email");

    await request(app)
      .patch(`/api/datasets/${ds.id}/columns/does-not-exist/classification`)
      .send({ category: "EMAIL" })
      .expect(404)
      .expect((r) => expect(r.body.error.code).toBe("column_not_found"));

    await request(app)
      .patch(`/api/datasets/does-not-exist/columns/${emailId}/classification`)
      .send({ category: "EMAIL" })
      .expect(404)
      .expect((r) => expect(r.body.error.code).toBe("dataset_not_found"));

    await request(app)
      .patch(`/api/datasets/${ds.id}/columns/${emailId}/classification`)
      .send({ category: "NOT_A_CATEGORY" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("validation_error"));
  });
});
