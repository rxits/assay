// Value-on-read (04 §2.4) + usage time-series (04 §2.6) against the real app + Prisma.
// A tracked detail GET records a LIVE DETAIL_VIEW and recomputes Value from all events; a
// fresh (zero-event) dataset is RETIRE (06 §8, R10) and jumps to KEEP after one view
// (opened-once-today ≈ 62.93). ?track=false suppresses the event and the recompute.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";

const CSV = "email,age\nada@x.io,36\ngrace@x.io,45";
const app = createApp();

async function upload(): Promise<string> {
  const res = await request(app).post("/api/datasets").attach("file", Buffer.from(CSV), "customers.csv").expect(201);
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

describe("GET /api/datasets/:id — value-on-read (04 §2.4)", () => {
  it("a detail view appends a LIVE DETAIL_VIEW and lifts Value off the zero-event baseline", async () => {
    const id = await upload();

    // Fresh upload has no access events → Value ~10 / RETIRE (06 §8, R10). Read without polluting.
    const before = (await request(app).get(`/api/datasets/${id}?track=false`).expect(200)).body.data;
    expect(before.valueRecommendation).toBe("RETIRE");
    expect(await prisma.accessEvent.count({ where: { datasetId: id } })).toBe(0);

    // Tracked view (default): records one event and recomputes Value. One view lifts the
    // score off the floor but must NOT clear it to KEEP — it used to reach 62.93 because
    // Recency and Trend both saturated on the first access, which is 55% of the weight. A
    // dataset opened once is exactly what "low activity" means, so it lands mid-band.
    const after = (await request(app).get(`/api/datasets/${id}`).expect(200)).body.data;
    expect(await prisma.accessEvent.count({ where: { datasetId: id, type: "DETAIL_VIEW", source: "LIVE" } })).toBe(1);
    expect(after.valueScore).toBeGreaterThan(before.valueScore);
    expect(after.valueScore).toBeCloseTo(31.6, 1);
    expect(after.valueRecommendation).not.toBe("KEEP");
    expect(after.usage.summary.accesses90d).toBe(1);
    expect(after.usage.summary.lastAccessedAt).not.toBeNull();
    // A snapshot was appended for the trend sparkline.
    expect(await prisma.scoreSnapshot.count({ where: { datasetId: id } })).toBe(1);
  });

  it("?track=false suppresses the event and the recompute", async () => {
    const id = await upload();
    await request(app).get(`/api/datasets/${id}`).expect(200); // 1 tracked
    const v1 = (await request(app).get(`/api/datasets/${id}`).expect(200)).body.data.valueScore; // 2 tracked
    const eventCount = await prisma.accessEvent.count({ where: { datasetId: id } });

    const untracked = (await request(app).get(`/api/datasets/${id}?track=false`).expect(200)).body.data;
    expect(await prisma.accessEvent.count({ where: { datasetId: id } })).toBe(eventCount); // no new event
    expect(untracked.valueScore).toBe(v1); // Value unchanged
  });

  it("rejects a bad track value with 422 validation_error", async () => {
    const id = await upload();
    const res = await request(app).get(`/api/datasets/${id}?track=maybe`).expect(422);
    expect(res.body.error.code).toBe("validation_error");
  });
});

describe("GET /api/datasets/:id/usage (04 §2.6)", () => {
  it("returns a zero-filled daily series with a fixed-window summary", async () => {
    const id = await upload();
    await request(app).get(`/api/datasets/${id}`).expect(200); // one tracked DETAIL_VIEW today

    const usage = (await request(app).get(`/api/datasets/${id}/usage`).expect(200)).body.data;
    expect(usage.datasetId).toBe(id);
    expect(usage.series).toHaveLength(90); // default days window
    // Every bucket carries a full, zero-filled byType breakdown — no gaps.
    for (const p of usage.series) {
      expect(p.byType).toEqual(
        expect.objectContaining({ VIEW: expect.any(Number), DETAIL_VIEW: expect.any(Number), DOWNLOAD: expect.any(Number) }),
      );
    }
    const total = usage.series.reduce((n: number, p: { total: number }) => n + p.total, 0);
    expect(total).toBe(1); // the single tracked view lands in today's bucket
    expect(usage.series[usage.series.length - 1].byType.DETAIL_VIEW).toBe(1);
    expect(usage.summary.accesses90d).toBe(1);
    expect(usage.summary.lastAccessedAt).not.toBeNull();
  });

  it("honors ?days (series width) and ?type (filters the whole view)", async () => {
    const id = await upload();
    await request(app).get(`/api/datasets/${id}`).expect(200); // records a DETAIL_VIEW

    const usage = (await request(app).get(`/api/datasets/${id}/usage?days=30&type=VIEW`).expect(200)).body.data;
    expect(usage.series).toHaveLength(30);
    // The only event is a DETAIL_VIEW; a VIEW filter yields an all-zero series + zeroed summary.
    expect(usage.series.reduce((n: number, p: { total: number }) => n + p.total, 0)).toBe(0);
    expect(usage.summary.accesses90d).toBe(0);
    expect(usage.summary.lastAccessedAt).toBeNull();
  });

  it("404s for an unknown dataset and 422s a bad days/type", async () => {
    const notFound = await request(app).get("/api/datasets/does-not-exist/usage").expect(404);
    expect(notFound.body.error.code).toBe("dataset_not_found");

    const id = await upload();
    await request(app).get(`/api/datasets/${id}/usage?days=0`).expect(422);
    await request(app).get(`/api/datasets/${id}/usage?type=BOGUS`).expect(422);
  });
});
