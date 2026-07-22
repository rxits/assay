// createApp() — the Express application factory (no listen; testable via Supertest).
// CORS is scoped to the single web origin (09 §5); every error leaves as the
// canonical `{ error: { code, message, details? } }` envelope (04 §1.3).
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import type { ApiError } from "@assay/shared";
import { healthRouter } from "./routes/health";
import { datasetsRouter } from "./routes/datasets";
import { settingsRouter } from "./routes/settings";
import { ApiHttpError } from "./lib/errors";
import { globalLimiter, mutationLimiter, requireAdmin } from "./lib/security";

export function createApp(): Express {
  const app = express();

  // Render (and any PaaS) terminates TLS one hop in front of us, so without this every
  // request looks like it came from the proxy and the rate limiters would bucket the whole
  // world into a single client. `1` trusts exactly that hop — never a blanket `true`.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN, methods: ["GET", "POST", "PATCH", "DELETE"] }));
  // Bodies here are settings patches and classification overrides — a few hundred bytes.
  // 1mb is generous headroom; file uploads take the multipart path and multer's own cap.
  app.use(express.json({ limit: "1mb" }));

  // Order matters: refuse floods before doing any work, and check the admin token before a
  // handler touches Postgres. Both gates are mounted by *path prefix* rather than per route,
  // so a route added under /api/settings or /api/data later is protected by default.
  app.use(globalLimiter);
  app.use(mutationLimiter);
  app.use("/api/settings", requireAdmin);
  app.use("/api/data", requireAdmin);

  app.use("/api", healthRouter);
  app.use("/api", datasetsRouter);
  app.use("/api", settingsRouter);

  app.use(errorHandler);

  return app;
}

// Central error handler. Express identifies it by its 4-arg signature, so `next`
// must stay in the list even though it is unused. Never leaks stack traces/SQL/paths.
function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  // express.json() throws a SyntaxError with a `body` prop on malformed JSON.
  if (err instanceof SyntaxError && "body" in err) {
    const body: ApiError = { error: { code: "malformed_json", message: "Request body is not valid JSON." } };
    res.status(400).json(body);
    return;
  }
  // Typed application errors carry their own status/code/details (04 §1.3–1.5).
  if (err instanceof ApiHttpError) {
    const body: ApiError = {
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    };
    res.status(err.status).json(body);
    return;
  }
  const body: ApiError = { error: { code: "internal_error", message: "An unexpected error occurred." } };
  res.status(500).json(body);
}
