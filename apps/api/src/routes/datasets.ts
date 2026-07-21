// Dataset routes (04 §2.2–2.4). Thin handlers: multer for the upload boundary,
// zod for field validation, services for the work, ApiHttpError for failures.
import { Router, type NextFunction, type Request, type Response } from "express";
import multer, { MulterError } from "multer";
import { z } from "zod";
import type { FileType } from "@assay/shared";
import { MAX_UPLOAD_BYTES } from "../lib/config";
import { ApiHttpError, fromZod } from "../lib/errors";
import { ingestDataset } from "../services/ingest";
import {
  catalogQuerySchema,
  detailQuerySchema,
  getDatasetDetail,
  getDatasetUsage,
  listDatasets,
  overrideClassification,
  usageQuerySchema,
} from "../services/catalog";

export const datasetsRouter = Router();

function fileTypeOf(filename: string): FileType | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return "CSV";
  if (lower.endsWith(".xlsx")) return "XLSX";
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!fileTypeOf(file.originalname)) {
      cb(new ApiHttpError(415, "unsupported_file_type", "Only .csv and .xlsx files are supported."));
      return;
    }
    cb(null, true);
  },
});

const uploadFieldsSchema = z.object({ name: z.string().trim().min(1).max(255).optional() });

// POST /api/datasets — multipart upload -> ingestion pipeline -> dataset summary.
datasetsRouter.post("/datasets", (req: Request, res: Response, next: NextFunction) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      next(translateUploadError(err));
      return;
    }
    void handleUpload(req, res, next);
  });
});

async function handleUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      throw new ApiHttpError(400, "missing_file", "Expected a `file` field in the multipart body.");
    }
    const fields = uploadFieldsSchema.safeParse(req.body ?? {});
    if (!fields.success) throw fromZod(fields.error);

    const summary = await ingestDataset({
      buffer: file.buffer,
      originalFilename: file.originalname,
      fileType: fileTypeOf(file.originalname)!, // guaranteed non-null by fileFilter
      sizeBytes: file.size,
      name: fields.data.name,
    });

    res.status(201).location(`/api/datasets/${summary.id}`).json({ data: summary });
  } catch (err) {
    next(err);
  }
}

// GET /api/datasets — paginated, filterable, sortable catalog list.
datasetsRouter.get("/datasets", (req: Request, res: Response, next: NextFunction) => {
  void handleList(req, res, next);
});

async function handleList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = catalogQuerySchema.safeParse(req.query);
    if (!query.success) throw fromZod(query.error);
    const { items, meta } = await listDatasets(query.data);
    res.json({ data: items, meta });
  } catch (err) {
    next(err);
  }
}

// GET /api/datasets/:id — full nested detail; records a DETAIL_VIEW + recomputes Value
// unless ?track=false (value-on-read, 04 §2.4).
datasetsRouter.get("/datasets/:id", (req: Request, res: Response, next: NextFunction) => {
  void handleDetail(req, res, next);
});

async function handleDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = detailQuerySchema.safeParse(req.query);
    if (!query.success) throw fromZod(query.error);
    const detail = await getDatasetDetail(req.params.id ?? "", query.data.track !== "false");
    if (!detail) throw new ApiHttpError(404, "dataset_not_found", "No dataset with that id.");
    res.json({ data: detail });
  } catch (err) {
    next(err);
  }
}

// GET /api/datasets/:id/usage — daily access time-series for the value chart (04 §2.6).
// No access event recorded (a sub-read of the value data is not itself a DETAIL_VIEW).
datasetsRouter.get("/datasets/:id/usage", (req: Request, res: Response, next: NextFunction) => {
  void handleUsage(req, res, next);
});

async function handleUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = usageQuerySchema.safeParse(req.query);
    if (!query.success) throw fromZod(query.error);
    const usage = await getDatasetUsage(req.params.id ?? "", query.data);
    res.json({ data: usage });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/datasets/:id/columns/:columnId/classification — manual override (04 §2.5).
datasetsRouter.patch(
  "/datasets/:id/columns/:columnId/classification",
  (req: Request, res: Response, next: NextFunction) => {
    void handleOverride(req, res, next);
  },
);

async function handleOverride(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await overrideClassification(req.params.id ?? "", req.params.columnId ?? "", req.body);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

function translateUploadError(err: unknown): unknown {
  if (err instanceof ApiHttpError) return err; // e.g. fileFilter's 415
  if (err instanceof MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return new ApiHttpError(413, "file_too_large", "File exceeds the 10 MiB upload limit.");
    }
    return new ApiHttpError(400, "malformed_json", "Malformed multipart upload.");
  }
  return err;
}
