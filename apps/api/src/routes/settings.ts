// Settings, system status, and the demo-data actions (R3). Thin handlers: zod validates,
// services do the work, ApiHttpError carries failures into the canonical error envelope.
import { Router, type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import type { DataMutationResult, SystemStatus } from "@assay/shared";
import { prisma } from "../lib/prisma";
import { CLASSIFY, INGEST, MAX_UPLOAD_MB } from "../lib/config";
import { ANTHROPIC_MODEL, anthropic } from "../lib/anthropic";
import { deleteAllDatasets, seedDemoData } from "../services/demo";
import { getSettings, patchSettings, recomputeAllScores, resetSettings } from "../services/settings";

export const settingsRouter = Router();

// Handlers are async; Express 4 doesn't await them, so every one funnels rejections into next().
const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

// GET /api/settings — effective settings + defaults + which keys are overridden.
settingsRouter.get(
  "/settings",
  handle(async (_req, res) => {
    res.json({ data: await getSettings() });
  }),
);

// PATCH /api/settings — partial update; weight sets that don't sum to 1.0 → 422.
settingsRouter.patch(
  "/settings",
  handle(async (req, res) => {
    res.json({ data: await patchSettings(req.body) });
  }),
);

// POST /api/settings/reset — drop every override.
settingsRouter.post(
  "/settings/reset",
  handle(async (_req, res) => {
    res.json({ data: await resetSettings() });
  }),
);

// POST /api/settings/recompute — re-score the whole catalog with the effective settings.
settingsRouter.post(
  "/settings/recompute",
  handle(async (_req, res) => {
    res.json({ data: await recomputeAllScores() });
  }),
);

// GET /api/system — health + DB connectivity + LLM state + ingestion caps + versions.
// Unlike /api/health (deliberately DB-free so the probe never wakes a scaled-to-zero DB),
// this one is the Settings page's diagnostic and DOES touch Postgres.
settingsRouter.get(
  "/system",
  handle(async (_req, res) => {
    const started = Date.now();
    let database: SystemStatus["database"] = { connected: false, latencyMs: null, datasetCount: null };
    try {
      const datasetCount = await prisma.dataset.count();
      database = { connected: true, latencyMs: Date.now() - started, datasetCount };
    } catch {
      // Reported, never thrown: "database unreachable" is the answer this endpoint exists to give.
      database = { connected: false, latencyMs: null, datasetCount: null };
    }

    const body: SystemStatus = {
      api: {
        status: "ok",
        service: "assay-api",
        env: process.env.NODE_ENV ?? "development",
        uptimeSeconds: Math.round(process.uptime()),
      },
      database,
      llm: { state: anthropic ? "configured" : "regex-fallback", model: ANTHROPIC_MODEL },
      ingestion: {
        maxUploadMb: MAX_UPLOAD_MB,
        sampleRowsCap: INGEST.sampleRowsCap,
        sampleValuesCap: INGEST.sampleValuesCap,
        classifySampleSize: CLASSIFY.SAMPLE_SIZE,
        aiSampleSize: CLASSIFY.AI_SAMPLE_SIZE,
        xlsxFirstSheetOnly: true,
      },
      versions: {
        api: process.env.npm_package_version ?? "0.1.0",
        node: process.version,
        prisma: Prisma.prismaVersion.client,
      },
    };
    res.json({ data: body });
  }),
);

// POST /api/data/reseed — re-run the committed demo catalog through the real pipeline.
settingsRouter.post(
  "/data/reseed",
  handle(async (_req, res) => {
    const result = await seedDemoData();
    res.json({ data: { datasets: result.datasets } satisfies DataMutationResult });
  }),
);

// DELETE /api/data/datasets — danger zone; the UI gates it behind a typed confirmation.
settingsRouter.delete(
  "/data/datasets",
  handle(async (_req, res) => {
    res.json({ data: (await deleteAllDatasets()) satisfies DataMutationResult });
  }),
);
