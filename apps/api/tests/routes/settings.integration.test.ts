// Settings API (R3) against the real Express app + Prisma (truncated per test).
// Proves: GET merges overrides over the code defaults and reports which keys are
// overridden; PATCH rejects a weight set that doesn't sum to 1.0 with 422
// validation_error; reset drops every override; and recompute actually moves a
// dataset's persisted trustScore using the new weights.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { config } from "../../src/lib/config";

// One missing `age` keeps Quality below 100, so a Trust re-weighting is observable
// (a spotless file scores 100 on every component and no weight change can move it).
const CSV = "email,age\nada@x.io,36\ngrace@x.io,\nalan@x.io,41";

const app = createApp();

async function upload(csv = CSV, filename = "customers.csv") {
  const res = await request(app).post("/api/datasets").attach("file", Buffer.from(csv), filename).expect(201);
  return res.body.data as { id: string; status: string; trustScore: number; qualityScore: number };
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "ClassificationTag","QualityCheck","AccessEvent","ScoreSnapshot","Column","Dataset","AppSettings" RESTART IDENTITY CASCADE',
  );
});

describe("GET /api/settings", () => {
  it("returns the code defaults with nothing overridden", async () => {
    const res = await request(app).get("/api/settings").expect(200);
    const body = res.body.data;

    expect(body.settings.quality).toEqual(config.quality);
    expect(body.settings.trust).toEqual(config.trust);
    expect(body.settings.freqCap).toBe(config.freqCap);
    expect(body.settings.sensitivity.EMAIL).toBe("HIGH");
    expect(body.defaults).toEqual(body.settings);
    expect(body.overridden).toEqual([]);
    expect(body.updatedAt).toBeNull();
  });
});

describe("PATCH /api/settings", () => {
  it("persists a valid partial update and marks the key overridden", async () => {
    const quality = { completeness: 0.5, validity: 0.25, uniqueness: 0.25 };
    const res = await request(app).patch("/api/settings").send({ quality }).expect(200);

    expect(res.body.data.settings.quality).toEqual(quality);
    expect(res.body.data.overridden).toEqual(["quality"]);
    // Untouched keys still read from the code defaults.
    expect(res.body.data.settings.trust).toEqual(config.trust);
    expect(res.body.data.defaults.quality).toEqual(config.quality);
    expect(res.body.data.updatedAt).toEqual(expect.any(String));

    // …and it survives the round trip.
    const after = await request(app).get("/api/settings").expect(200);
    expect(after.body.data.settings.quality).toEqual(quality);
  });

  it("rejects a weight set that does not sum to 1.0 with 422 validation_error", async () => {
    const res = await request(app)
      .patch("/api/settings")
      .send({ quality: { completeness: 0.5, validity: 0.3, uniqueness: 0.3 } })
      .expect(422);

    expect(res.body.error.code).toBe("validation_error");
    expect(res.body.error.details[0].field).toBe("quality");
    expect(res.body.error.details[0].message).toMatch(/sum to 1/i);

    // Nothing was written.
    const after = await request(app).get("/api/settings").expect(200);
    expect(after.body.data.overridden).toEqual([]);
  });

  it("accepts a weight set inside the ±0.001 tolerance", async () => {
    await request(app)
      .patch("/api/settings")
      .send({ value: { frequency: 0.3335, recency: 0.3335, trend: 0.3335 } })
      .expect(200);
  });

  it("rejects out-of-order recommendation cutoffs and unknown keys", async () => {
    await request(app)
      .patch("/api/settings")
      .send({ recommend: { retireBelow: 70, archiveBelow: 35, optimizeBelow: 60 } })
      .expect(422);
    await request(app).patch("/api/settings").send({ nope: 1 }).expect(422);
  });
});

describe("POST /api/settings/reset", () => {
  it("clears every override and returns the defaults", async () => {
    await request(app)
      .patch("/api/settings")
      .send({ freqCap: 5, halfLifeDays: 7 })
      .expect(200);

    const res = await request(app).post("/api/settings/reset").expect(200);
    expect(res.body.data.overridden).toEqual([]);
    expect(res.body.data.settings.freqCap).toBe(config.freqCap);
    expect(res.body.data.settings.halfLifeDays).toBe(config.halfLifeDays);

    const after = await request(app).get("/api/settings").expect(200);
    expect(after.body.data.settings).toEqual(after.body.data.defaults);
  });
});

describe("POST /api/settings/recompute", () => {
  it("re-scores every dataset with the effective settings", async () => {
    const uploaded = await upload();
    expect(uploaded.status).toBe("READY");
    const before = await prisma.dataset.findUniqueOrThrow({ where: { id: uploaded.id } });

    // Push Trust almost entirely onto Quality; the dataset's Quality < 100, so Trust must drop
    // (Consistency and Coverage both sit at 1.0 for a clean, fully-classified file).
    await request(app)
      .patch("/api/settings")
      .send({ trust: { quality: 1, consistency: 0, classificationCoverage: 0 } })
      .expect(200);

    const res = await request(app).post("/api/settings/recompute").expect(200);
    expect(res.body.data.updated).toBe(1);
    expect(res.body.data.skipped).toBe(0);

    const after = await prisma.dataset.findUniqueOrThrow({ where: { id: uploaded.id } });
    expect(after.trustScore).not.toBeCloseTo(before.trustScore!, 4);
    expect(after.trustScore).toBeCloseTo(before.qualityScore!, 4);
    // The stored breakdown carries the new weights, so "explain this score" stays honest.
    const breakdown = after.scoreBreakdown as unknown as { trust: { weights: { quality: number } } };
    expect(breakdown.trust.weights.quality).toBe(1);
  });

  it("re-maps non-overridden tags onto the sensitivity map but never a manual override", async () => {
    const uploaded = await upload();
    const emailColumn = await prisma.column.findFirstOrThrow({
      where: { datasetId: uploaded.id, name: "email" },
      include: { classificationTag: true },
    });
    expect(emailColumn.classificationTag?.sensitivity).toBe("HIGH");

    // A human decision on the `age` column — recompute must not touch it.
    const ageColumn = await prisma.column.findFirstOrThrow({ where: { datasetId: uploaded.id, name: "age" } });
    await request(app)
      .patch(`/api/datasets/${uploaded.id}/columns/${ageColumn.id}/classification`)
      .send({ category: "NONE", sensitivity: "HIGH" })
      .expect(200);

    const sensitivity = {
      EMAIL: "LOW", PHONE: "HIGH", ID_NUMBER: "HIGH", CREDIT_CARD: "HIGH", DATE_OF_BIRTH: "HIGH",
      NAME: "MEDIUM", ADDRESS: "MEDIUM", IP_ADDRESS: "MEDIUM", POSTAL_CODE: "LOW", NONE: "NONE", OTHER: "LOW",
    };
    await request(app).patch("/api/settings").send({ sensitivity }).expect(200);

    const res = await request(app).post("/api/settings/recompute").expect(200);
    expect(res.body.data.tagsUpdated).toBeGreaterThan(0);

    const tag = await prisma.classificationTag.findUniqueOrThrow({ where: { columnId: emailColumn.id } });
    expect(tag.sensitivity).toBe("LOW");
    const manual = await prisma.classificationTag.findUniqueOrThrow({ where: { columnId: ageColumn.id } });
    expect(manual.sensitivity).toBe("HIGH"); // untouched
  });

  it("skips datasets that never scored", async () => {
    await upload("a,b,c\n1,2,3,4\n5,6", "broken.csv"); // ragged → FAILED, no breakdown
    const res = await request(app).post("/api/settings/recompute").expect(200);
    expect(res.body.data.updated).toBe(0);
    expect(res.body.data.skipped).toBe(1);
  });
});

describe("GET /api/system", () => {
  it("reports DB connectivity, the LLM state, the upload cap and versions", async () => {
    const res = await request(app).get("/api/system").expect(200);
    const s = res.body.data;

    expect(s.api.status).toBe("ok");
    expect(s.database.connected).toBe(true);
    expect(s.database.datasetCount).toBe(0);
    // No GROQ_API_KEY in test → the regex-only path (07 §6.1).
    expect(s.llm.state).toBe(process.env.GROQ_API_KEY ? "configured" : "regex-fallback");
    expect(s.ingestion.maxUploadMb).toBeGreaterThan(0);
    expect(s.ingestion.xlsxFirstSheetOnly).toBe(true);
    expect(s.versions.node).toBe(process.version);
  });
});

describe("DELETE /api/data/datasets", () => {
  it("drops every dataset and cascades", async () => {
    await upload();
    const res = await request(app).delete("/api/data/datasets").expect(200);
    expect(res.body.data.datasets).toBe(1);
    expect(await prisma.dataset.count()).toBe(0);
    expect(await prisma.column.count()).toBe(0);
  });
});

// The gate reads ADMIN_TOKEN per request, so setting it here exercises the deployed
// behaviour without a second app instance. Every test above runs with it unset — which is
// itself the assertion that an unset token stays out of the way in dev and CI.
describe("admin gate (ADMIN_TOKEN set)", () => {
  const TOKEN = "0123456789abcdef0123456789abcdef";
  const auth = () => ({ "x-admin-token": TOKEN });

  beforeAll(() => {
    process.env.ADMIN_TOKEN = TOKEN;
  });
  afterAll(() => {
    delete process.env.ADMIN_TOKEN;
  });

  it("refuses every mutating route with no header", async () => {
    for (const send of [
      () => request(app).patch("/api/settings").send({ freqCap: 5 }),
      () => request(app).post("/api/settings/reset"),
      () => request(app).post("/api/settings/recompute"),
      () => request(app).post("/api/data/reseed"),
      () => request(app).delete("/api/data/datasets"),
    ]) {
      const res = await send().expect(401);
      expect(res.body.error.code).toBe("admin_token_required");
    }
  });

  it("refuses a wrong token, including one of a different length", async () => {
    for (const bad of ["nope", `${TOKEN}x`, TOKEN.slice(0, -1)]) {
      const res = await request(app).delete("/api/data/datasets").set("x-admin-token", bad).expect(401);
      expect(res.body.error.code).toBe("admin_token_required");
    }
    expect(await prisma.dataset.count()).toBe(0); // and nothing ran
  });

  it("lets the same mutations through with the correct header", async () => {
    const patched = await request(app).patch("/api/settings").set(auth()).send({ freqCap: 5 }).expect(200);
    expect(patched.body.data.settings.freqCap).toBe(5);

    await request(app).post("/api/settings/recompute").set(auth()).expect(200);
    await request(app).post("/api/settings/reset").set(auth()).expect(200);

    const uploaded = await upload();
    const deleted = await request(app).delete("/api/data/datasets").set(auth()).expect(200);
    expect(deleted.body.data.datasets).toBe(1);
    expect(uploaded.id).toEqual(expect.any(String));
  });

  it("leaves reads, uploads and classification overrides open", async () => {
    await request(app).get("/api/settings").expect(200);
    await request(app).get("/api/system").expect(200);

    // The whole point of the gate: a reviewer with no token can still *use* the app.
    const uploaded = await upload();
    const column = await prisma.column.findFirstOrThrow({ where: { datasetId: uploaded.id, name: "age" } });
    await request(app)
      .patch(`/api/datasets/${uploaded.id}/columns/${column.id}/classification`)
      .send({ category: "NONE" })
      .expect(200);
  });
});
