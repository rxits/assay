// Supertest against the real Express app + real Prisma (throwaway/dev test DB,
// truncated per test). Phase 2B reality (08 §9): ingestion now classifies, quality-checks,
// and scores — so this asserts scores present, PII tags, populated checks, and that the
// AI layer is disabled (no ANTHROPIC_API_KEY) → regex resolves, healthNarrative null.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { MAX_UPLOAD_BYTES } from "../../src/lib/config";

const CSV = [
  "email,full_name,age,signup_date",
  "ada@example.com,Ada Lovelace,36,2023-01-15",
  "grace@example.com,Grace Hopper,45,2023-02-20",
  "alan@example.com,Alan Turing,41,2023-03-10",
  "ada@example.com,Ada Lovelace,36,2023-01-15", // duplicates row 1
].join("\n");

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

describe("POST /api/datasets — ingestion + classification + scoring", () => {
  it("ingests a CSV: 201 READY with scores, PII tags, and quality checks", async () => {
    const res = await request(app)
      .post("/api/datasets")
      .attach("file", Buffer.from(CSV), "customers.csv")
      .expect(201);

    const ds = res.body.data;
    expect(ds.status).toBe("READY");
    expect(ds.rowCount).toBe(4);
    expect(ds.columnCount).toBe(4);
    expect(ds.fileType).toBe("CSV");
    // Completeness=Validity=1.0, 1 duplicate row → Uniqueness=0.75.
    // Quality = 100·(0.40·1 + 0.30·1 + 0.30·0.75) = 92.5.
    expect(ds.qualityScore).toBeCloseTo(92.5, 1);
    expect(ds.trustScore).toBeGreaterThan(0);
    expect(ds.piiColumnCount).toBeGreaterThanOrEqual(1); // email, full_name

    // Every column is now classified (incl. explicit NONE) — coverage 1.0.
    expect(await prisma.classificationTag.count()).toBe(4);

    const columns = await prisma.column.findMany({
      where: { datasetId: ds.id },
      orderBy: { position: "asc" },
      include: { classificationTag: true },
    });
    expect(columns.map((c) => c.name)).toEqual(["email", "full_name", "age", "signup_date"]);
    const email = columns.find((c) => c.name === "email")!;
    expect(email.dataType).toBe("STRING");
    expect(email.classificationTag?.category).toBe("EMAIL");
    expect(email.classificationTag?.sensitivity).toBe("HIGH");
    expect(email.classificationTag?.source).toBe("AUTO_REGEX"); // AI disabled locally

    // signup_date is a DATE but NOT date-of-birth → NONE (false-positive guard).
    const date = columns.find((c) => c.name === "signup_date")!;
    expect(date.dataType).toBe("DATE");
    expect(date.classificationTag?.category).toBe("NONE");

    // Quality checks are populated (the duplicate row is detected).
    const checks = await prisma.qualityCheck.findMany({ where: { datasetId: ds.id } });
    expect(checks.some((c) => c.checkType === "DUPLICATE_ROWS")).toBe(true);
  });

  it("scores customers.csv high with EMAIL/PHONE PII, and messy_orders.csv visibly lower", async () => {
    const customers = (
      await request(app).post("/api/datasets").attach("file", sample("customers.csv"), "customers.csv").expect(201)
    ).body.data;
    const messy = (
      await request(app).post("/api/datasets").attach("file", sample("messy_orders.csv"), "messy_orders.csv").expect(201)
    ).body.data;

    expect(customers.status).toBe("READY");
    expect(customers.qualityScore).toBeGreaterThan(90);
    expect(customers.highestSensitivity).toBe("HIGH");
    // AI disabled → no narrative.
    const cDetail = (await request(app).get(`/api/datasets/${customers.id}`).expect(200)).body.data;
    expect(cDetail.healthNarrative).toBeNull();
    const email = cDetail.columns.find((c: { name: string }) => c.name === "email");
    expect(email.classificationTag.category).toBe("EMAIL");
    expect(email.classificationTag.sensitivity).toBe("HIGH");
    const phone = cDetail.columns.find((c: { name: string }) => c.name === "phone");
    expect(phone.classificationTag.category).toBe("PHONE");

    expect(messy.status).toBe("READY");
    expect(messy.qualityScore).toBeLessThan(customers.qualityScore);
    const mDetail = (await request(app).get(`/api/datasets/${messy.id}`).expect(200)).body.data;
    expect(mDetail.qualityChecks.length).toBeGreaterThan(0);
    const notes = mDetail.columns.find((c: { name: string }) => c.name === "notes");
    expect(notes.completeness).toBe(0); // empty column
    expect(mDetail.qualityChecks.some((c: { checkType: string }) => c.checkType === "EMPTY_COLUMN")).toBe(true);
    const custEmail = mDetail.columns.find((c: { name: string }) => c.name === "customer_email");
    expect(custEmail.classificationTag.category).toBe("EMAIL");
  });

  it("records a non-rectangular sample (broken.csv) as a graceful FAILED dataset", async () => {
    const res = await request(app)
      .post("/api/datasets")
      .attach("file", sample("broken.csv"), "broken.csv")
      .expect(201);
    expect(res.body.data.status).toBe("FAILED");
    expect(res.body.data.errorMessage).toBeTruthy();
    expect(res.body.data.qualityScore).toBeNull(); // R1: null scores on FAILED
    expect(await prisma.classificationTag.count()).toBe(0); // no tags for a failed ingest
  });

  it("uses a provided name over the filename", async () => {
    const res = await request(app)
      .post("/api/datasets")
      .field("name", "Customer master")
      .attach("file", Buffer.from(CSV), "customers.csv")
      .expect(201);
    expect(res.body.data.name).toBe("Customer master");
    expect(res.body.data.originalFilename).toBe("customers.csv");
  });

  it("rejects a non-CSV/XLSX upload with 415 unsupported_file_type (R4)", async () => {
    const res = await request(app)
      .post("/api/datasets")
      .attach("file", Buffer.from("%PDF-1.7 fake"), "notes.pdf")
      .expect(415);
    expect(res.body.error.code).toBe("unsupported_file_type");
    expect(await prisma.dataset.count()).toBe(0); // rejected before any row
  });

  it("returns 400 missing_file when no file part is present", async () => {
    const res = await request(app).post("/api/datasets").field("name", "x").expect(400);
    expect(res.body.error.code).toBe("missing_file");
  });

  it("records a non-rectangular file as a graceful FAILED dataset (not a 500)", async () => {
    const broken = "a,b,c\n1,2,3,4\n5,6"; // ragged rows against a 3-col header
    const res = await request(app)
      .post("/api/datasets")
      .attach("file", Buffer.from(broken), "broken.csv")
      .expect(201);
    expect(res.body.data.status).toBe("FAILED");
    expect(res.body.data.errorMessage).toBeTruthy();
    expect(await prisma.dataset.count()).toBe(1);
  });

  it("rejects an empty file with 422 empty_file and creates no row", async () => {
    const res = await request(app)
      .post("/api/datasets")
      .attach("file", Buffer.from(""), "empty.csv")
      .expect(422);
    expect(res.body.error.code).toBe("empty_file");
    expect(await prisma.dataset.count()).toBe(0);
  });

  it("rejects an oversized file with 413 file_too_large (multer cap, no row) — 08 §6 #5", async () => {
    // One byte over the 10 MiB cap → multer aborts with LIMIT_FILE_SIZE before the handler runs.
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61); // filled with "a"
    const res = await request(app)
      .post("/api/datasets")
      .attach("file", oversized, "big.csv")
      .expect(413);
    expect(res.body.error.code).toBe("file_too_large");
    expect(await prisma.dataset.count()).toBe(0); // rejected pre-parse, never persisted
  });
});
