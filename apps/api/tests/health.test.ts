import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

describe("GET /api/health", () => {
  it("returns 200 with a flat, DB-free liveness body (04 §2.1)", async () => {
    const res = await request(createApp()).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("assay-api");
    expect(typeof res.body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });
});
