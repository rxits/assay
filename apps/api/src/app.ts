// createApp() — the Express application factory (no listen; testable via Supertest).
// CORS is scoped to the single web origin (09 §5); every error leaves as the
// canonical `{ error: { code, message, details? } }` envelope (04 §1.3).
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import type { ApiError } from "@assay/shared";
import { healthRouter } from "./routes/health";
import { datasetsRouter } from "./routes/datasets";
import { settingsRouter } from "./routes/settings";
import { ApiHttpError } from "./lib/errors";

export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN, methods: ["GET", "POST", "PATCH", "DELETE"] }));
  app.use(express.json());

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
