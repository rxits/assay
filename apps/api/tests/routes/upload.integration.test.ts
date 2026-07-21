// Supertest against the real Express app + real Prisma (throwaway/dev test DB,
// truncated per test). Based on 08 §9, adapted to Phase 1: scoring and
// classification land in Phase 2, so this asserts ingestion + discovery only
// (counts, status, column types) and R4's 415 for a bad file type.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";

const CSV = [
  "email,full_name,age,signup_date",
  "ada@example.com,Ada Lovelace,36,2023-01-15",
  "grace@example.com,Grace Hopper,45,2023-02-20",
  "alan@example.com,Alan Turing,41,2023-03-10",
  "ada@example.com,Ada Lovelace,36,2023-01-15", // duplicates row 1
].join("\n");

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

describe("POST /api/datasets — ingestion + discovery", () => {
  it("ingests a CSV: 201 READY with correct counts and inferred column types", async () => {
    const res = await request(app)
      .post("/api/datasets")
      .attach("file", Buffer.from(CSV), "customers.csv")
      .expect(201);

    const ds = res.body.data;
    expect(ds.status).toBe("READY");
    expect(ds.rowCount).toBe(4);
    expect(ds.columnCount).toBe(4);
    expect(ds.fileType).toBe("CSV");
    expect(ds.qualityScore).toBeNull(); // scoring is Phase 2

    // Columns persisted with the inferred types; signup_date is a DATE, not DOB.
    const columns = await prisma.column.findMany({
      where: { datasetId: ds.id },
      orderBy: { position: "asc" },
    });
    expect(columns.map((c) => c.name)).toEqual(["email", "full_name", "age", "signup_date"]);
    expect(columns.find((c) => c.name === "email")?.dataType).toBe("STRING");
    expect(columns.find((c) => c.name === "age")?.dataType).toBe("INTEGER");
    expect(columns.find((c) => c.name === "signup_date")?.dataType).toBe("DATE");
    // No classification tags in Phase 1.
    expect(await prisma.classificationTag.count()).toBe(0);
  });

  it("uses a provided name over the filename and caps the sample preview", async () => {
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
    // Still catalogued — a broken dataset is a first-class citizen.
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
});
