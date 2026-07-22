// Security middleware for a public, deliberately auth-free demo (00-SPEC §12, 09 §5).
//
// The brief asks for no user accounts, and reviewers must be able to open the deployed URL
// and *use* it — so reads and uploads stay open. What must not stay open is the ability to
// wipe or re-tune the shared catalog from a URL bar. Those two requirements meet here:
//
//   safe methods (GET/HEAD/OPTIONS) → never gated, never strictly rate-limited
//   mutations under /api/settings and /api/data → ADMIN_TOKEN
//   everything → a global rate limit; mutations → a much stricter one
//
// The gate is mounted by *path prefix* in app.ts rather than listed per route, so a route
// added under those prefixes later is protected by default rather than by remembering to
// decorate it. Failing safe is the point.
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import type { ApiError, ApiErrorCode } from "@assay/shared";

/** Reads are open to everyone; only state-changing verbs go through the gate. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Vitest sets NODE_ENV=test; a suite fires hundreds of requests from one IP by design. */
const isTest = process.env.NODE_ENV === "test";

/**
 * The CORS allowlist, read from a comma-separated `CORS_ORIGIN` (one entry is the norm).
 *
 * The subtlety worth naming: `cors({ origin: undefined })` does not mean "no origins", it
 * means `*`. A production deploy that simply forgot the variable would therefore publish
 * the API to every site on the internet — silently, because nothing in the app misbehaves.
 * Returning `false` instead keeps the failure mode identical to `requireAdmin`: when the
 * operator has said nothing, the answer is no. Development falls back to the Vite dev
 * server so a fresh clone with no .env still runs.
 */
export function corsOrigins(): string[] | false {
  const configured = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return process.env.NODE_ENV === "production" ? false : ["http://localhost:5173"];
}

function deny(res: Response, status: number, code: ApiErrorCode, message: string): void {
  const body: ApiError = { error: { code, message } };
  res.status(status).json(body);
}

/**
 * Constant-time token comparison. `timingSafeEqual` throws on length mismatch — which would
 * itself leak the token's length — so both sides are hashed to a fixed 32 bytes first and the
 * digests are compared instead.
 */
function tokenMatches(provided: string, expected: string): boolean {
  const sha = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(sha(provided), sha(expected));
}

/** True when this process will refuse mutations outright (see `requireAdmin`). */
export const adminGateFailsClosed = (): boolean =>
  !process.env.ADMIN_TOKEN && process.env.NODE_ENV === "production";

/**
 * Gate a mutating request on the `x-admin-token` header.
 *
 * - `ADMIN_TOKEN` set → header must match, else 401.
 * - `ADMIN_TOKEN` unset in production → **fail closed**, 403. A public demo that anyone can
 *   empty with one `curl -X DELETE` is worse than one with a broken danger zone, and an
 *   unset secret in production is far more likely to be an oversight than a decision.
 * - `ADMIN_TOKEN` unset outside production → allowed, so local dev and the test suite need
 *   no ceremony. `index.ts` warns once at boot.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    if (adminGateFailsClosed()) {
      deny(
        res,
        403,
        "admin_disabled",
        "This deployment has no ADMIN_TOKEN configured, so destructive actions are disabled. Set ADMIN_TOKEN on the API host to enable them.",
      );
      return;
    }
    next(); // dev/test convenience only — never reachable in production
    return;
  }
  const provided = req.header("x-admin-token");
  if (!provided || !tokenMatches(provided, expected)) {
    deny(res, 401, "admin_token_required", "A valid x-admin-token header is required for this action.");
    return;
  }
  next();
}

const limitReached = (_req: Request, res: Response): void =>
  deny(res, 429, "rate_limited", "Too many requests. Please slow down and try again shortly.");

const limiter = (windowMs: number, max: number, only?: (req: Request) => boolean): RateLimitRequestHandler =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: limitReached,
    skip: (req) => isTest || (only ? !only(req) : false),
  });

/**
 * Whole-surface budget. Sized for a human with the dashboard open — the Settings page polls
 * `/api/system` every 30s and the catalog refetches on filter changes — not for a scraper.
 */
export const globalLimiter = limiter(15 * 60_000, 600);

/**
 * Mutations only, and far tighter: every one of them either burns CPU (a 100 MB parse, a
 * full-catalog rescore) or changes shared state. Applied globally with a method filter so it
 * covers uploads, classification overrides and the settings/data routes in one place.
 */
export const mutationLimiter = limiter(15 * 60_000, 30, (req) => !SAFE_METHODS.has(req.method));
