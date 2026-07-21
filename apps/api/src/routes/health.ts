// GET /api/health — pure liveness (04 §2.1). DB-free on purpose: touching Postgres
// would wake Neon from scale-to-zero and slow the probe (09 §8).
import { Router } from "express";
import type { HealthResponse } from "@assay/shared";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  const body: HealthResponse = {
    status: "ok",
    service: "assay-api",
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});
