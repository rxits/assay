// The case that matters is the one nothing else catches: an unset CORS_ORIGIN in
// production. `cors()` reads `undefined` as `*`, so the app would work perfectly while
// being readable from any site — the failure is invisible until someone looks. These
// assertions pin the fail-closed behaviour so a later refactor cannot quietly restore it.
import { describe, it, expect, afterEach } from "vitest";
import { corsOrigins } from "./security";

const original = { cors: process.env.CORS_ORIGIN, nodeEnv: process.env.NODE_ENV };

afterEach(() => {
  process.env.CORS_ORIGIN = original.cors;
  process.env.NODE_ENV = original.nodeEnv;
});

describe("corsOrigins", () => {
  it("refuses every origin when unset in production", () => {
    delete process.env.CORS_ORIGIN;
    process.env.NODE_ENV = "production";
    expect(corsOrigins()).toBe(false);
  });

  it("falls back to the Vite dev server outside production", () => {
    delete process.env.CORS_ORIGIN;
    process.env.NODE_ENV = "development";
    expect(corsOrigins()).toEqual(["http://localhost:5173"]);
  });

  it("reads a single origin", () => {
    process.env.CORS_ORIGIN = "https://assay-one.vercel.app";
    expect(corsOrigins()).toEqual(["https://assay-one.vercel.app"]);
  });

  it("splits a comma-separated list and trims the padding a copy-paste leaves behind", () => {
    process.env.CORS_ORIGIN = " https://a.example.com , https://b.example.com ";
    expect(corsOrigins()).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("treats a whitespace-only value as unset rather than as an origin named ''", () => {
    process.env.CORS_ORIGIN = "  ,  ";
    process.env.NODE_ENV = "production";
    expect(corsOrigins()).toBe(false);
  });
});
