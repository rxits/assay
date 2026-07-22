// @assay/shared — the wire contract imported by both apps/api and apps/web.
// Enums mirror 00-SPEC §6/§8 exactly. String-literal unions (not TS `enum`) keep
// them structurally identical to Prisma's generated enum strings and safe over the wire.
// Source of record: docs/04-API-DESIGN.md §4 (copied verbatim).

// ---- Enums (00-SPEC §6, §8) ----
export type FileType = "CSV" | "XLSX";
export type DatasetStatus = "PROCESSING" | "READY" | "FAILED";
export type ValueRecommendation = "KEEP" | "OPTIMIZE" | "ARCHIVE" | "RETIRE";
export type DataType =
  | "STRING" | "INTEGER" | "FLOAT" | "BOOLEAN" | "DATE" | "DATETIME" | "UNKNOWN";
export type PiiCategory =
  | "EMAIL" | "PHONE" | "ID_NUMBER" | "CREDIT_CARD" | "DATE_OF_BIRTH"
  | "NAME" | "ADDRESS" | "IP_ADDRESS" | "POSTAL_CODE" | "NONE" | "OTHER";
export type Sensitivity = "NONE" | "LOW" | "MEDIUM" | "HIGH";
export type TagSource = "AUTO_REGEX" | "AUTO_AI" | "MANUAL";
export type QualityCheckType =
  | "MISSING_VALUES" | "DUPLICATE_ROWS" | "INVALID_VALUES"
  | "TYPE_MISMATCH" | "EMPTY_COLUMN" | "DUPLICATE_HEADER";
export type Severity = "INFO" | "WARNING" | "ERROR";
export type AccessType = "VIEW" | "DETAIL_VIEW" | "DOWNLOAD";
export type AccessSource = "SEED" | "LIVE";

// ---- Envelope & errors ----
export interface ApiSuccess<T> { data: T; }
export interface ApiCollection<T> { data: T[]; meta: PaginationMeta; }
export interface PaginationMeta { total: number; limit: number; offset: number; count: number; }

export type ApiErrorCode =
  | "malformed_json" | "missing_file" | "unsupported_file_type" | "file_too_large"
  | "empty_file" | "invalid_file" | "validation_error"
  | "dataset_not_found" | "column_not_found" | "internal_error"
  // Security envelope (R3): a mutation was refused before it ran.
  | "admin_token_required" | "admin_disabled" | "rate_limited";

export interface ApiError {
  error: { code: ApiErrorCode; message: string; details?: FieldError[]; };
}
export interface FieldError { field: string; message: string; code: string; }

// ---- Scoring (00-SPEC §9) ----
export interface QualityBreakdown {
  score: number;
  inputs: { completeness: number; validity: number; uniqueness: number };
  weights: { completeness: number; validity: number; uniqueness: number };
}
export interface TrustBreakdown {
  score: number;
  inputs: { quality: number; consistency: number; classificationCoverage: number };
  weights: { quality: number; consistency: number; classificationCoverage: number };
}
export interface ValueBreakdown {
  score: number;
  inputs: { frequency: number; recency: number; trend: number };
  weights: { frequency: number; recency: number; trend: number };
  raw: {
    accesses90d: number; accessesLast30: number; accessesPrev30: number;
    daysSinceLastAccess: number; freqCap: number; halfLife: number;
  };
}
export interface ScoreBreakdown {
  quality: QualityBreakdown;
  trust: TrustBreakdown;
  value: ValueBreakdown;
}

// ---- Core entity DTOs ----
export interface ClassificationTagDTO {
  id: string;
  category: PiiCategory;
  sensitivity: Sensitivity;
  source: TagSource;
  confidence: number | null;
  overridden: boolean;
  createdAt: string;   // ISO-8601
  updatedAt: string;
}

export interface ColumnDTO {
  id: string;
  name: string;
  position: number;
  dataType: DataType;
  missingCount: number;
  missingPct: number;        // 0–1
  distinctCount: number;
  completeness: number;      // 0–1
  validity: number;          // 0–1
  sampleValues: unknown[];   // ≤10 (00-SPEC §6)
  classificationTag: ClassificationTagDTO | null;
}

export interface QualityCheckDTO {
  id: string;
  columnId: string | null;   // null = dataset-level
  checkType: QualityCheckType;
  severity: Severity;
  affectedCount: number;
  affectedPct: number;       // 0–1
  detail: string;
  createdAt: string;
}

export interface UsagePoint {
  date: string;              // YYYY-MM-DD
  total: number;
  byType?: Record<AccessType, number>;
}
export interface UsageSeries {
  datasetId: string;
  from: string;              // YYYY-MM-DD
  to: string;
  series: UsagePoint[];
  summary: {
    accesses90d: number;
    accessesLast30: number;
    accessesPrev30: number;
    lastAccessedAt: string | null;
  };
}

/** Catalog list item & POST /datasets response. */
export interface DatasetSummary {
  id: string;
  name: string;
  originalFilename: string;
  fileType: FileType;
  sizeBytes: number;
  rowCount: number;
  columnCount: number;
  status: DatasetStatus;
  qualityScore: number | null;
  trustScore: number | null;
  valueScore: number | null;
  valueRecommendation: ValueRecommendation | null;
  piiColumnCount: number;               // derived: columns with sensitivity > NONE
  highestSensitivity: Sensitivity | null; // derived: max column sensitivity (drives ?sensitivity filter & badge)
  lastAccessedAt: string | null;        // derived
  accessCount: number;                  // derived: total AccessEvents ("usage/view count")
  accessCount90d: number;               // derived: AccessEvents in the trailing 90-day window
  errorMessage: string | null;
  uploadedAt: string;
  updatedAt: string;
}

/** GET /datasets/:id — full nested detail. */
export interface DatasetDetail extends DatasetSummary {
  scoreBreakdown: ScoreBreakdown | null;   // null when FAILED
  healthNarrative: string | null;
  columns: ColumnDTO[];
  qualityChecks: QualityCheckDTO[];
  usage: UsageSeries;
  sampleRows?: Record<string, unknown>[];  // capped ≤50 preview (00-SPEC §6)
}

// ---- Request DTOs ----
/** POST /datasets — multipart: `file` part + optional `name` text field. */
export interface UploadDatasetFields { name?: string; }

/** PATCH …/classification body. */
export interface ClassificationOverrideRequest {
  category: PiiCategory;
  sensitivity?: Sensitivity;  // defaults to category default (00-SPEC §8)
}

/** PATCH …/classification response. */
export interface ClassificationOverrideResponse {
  column: ColumnDTO;
  dataset: Pick<DatasetSummary, "id" | "qualityScore" | "trustScore" | "valueScore" | "updatedAt">
    & { scoreBreakdown: Pick<ScoreBreakdown, "trust"> };
}

/** GET /datasets query. */
export interface CatalogQuery {
  limit?: number;
  offset?: number;
  sort?: string;             // e.g. "-uploadedAt", "trustScore"
  sensitivity?: Sensitivity;
  recommendation?: ValueRecommendation;
}

/** GET /datasets/:id/usage query. */
export interface UsageQuery { days?: number; type?: AccessType; }

/** GET /overview — catalog-wide aggregate powering the dashboard home (R1.2). */
export interface OverviewRecentUpload {
  id: string;
  name: string;
  uploadedAt: string;          // ISO-8601
  qualityScore: number | null; // null while PROCESSING / when FAILED
}
export interface OverviewAttentionItem {
  id: string;
  name: string;
  valueRecommendation: ValueRecommendation | null;
  status: DatasetStatus;
}
export interface DatasetOverview {
  totalDatasets: number;
  ready: number;
  failed: number;
  processing: number;
  // Averages over the datasets that carry each score (READY); 0 when none exist.
  avgQuality: number;
  avgTrust: number;
  avgValue: number;
  totalRows: number;
  totalColumns: number;
  piiColumnCount: number;                              // columns whose tag is > NONE
  sensitivityDistribution: Record<Sensitivity, number>;         // classified columns per level
  recommendationDistribution: Record<ValueRecommendation, number>; // scored datasets per recommendation
  recentUploads: OverviewRecentUpload[];               // newest first, ≤ 5
  needsAttention: OverviewAttentionItem[];             // RETIRE or FAILED, ≤ 10
}

export interface HealthResponse {
  status: "ok";
  service: string;
  timestamp: string;
}

// ---- App settings (R3) --------------------------------------------------
// The tunables an operator may override at runtime. Mirrors apps/api/src/lib/config.ts
// (06 §3 / 07 §0) minus the constants the UI keeps read-only. Every weight set must
// sum to 1.0 (±0.001) — enforced by the PATCH schema, mirrored by the form.
export interface QualityWeights { completeness: number; validity: number; uniqueness: number }
export interface TrustWeights { quality: number; consistency: number; classificationCoverage: number }
export interface ValueWeights { frequency: number; recency: number; trend: number }
export interface RecommendThresholds { retireBelow: number; archiveBelow: number; optimizeBelow: number }

export interface AppSettings {
  quality: QualityWeights;
  trust: TrustWeights;
  value: ValueWeights;
  classifyThreshold: number;   // 0–1 value-match share to auto-classify
  freqCap: number;             // accesses at which Frequency saturates
  halfLifeDays: number;        // Recency decay half-life
  recommend: RecommendThresholds;
  sensitivity: Record<PiiCategory, Sensitivity>; // default sensitivity per PII category
}

/** Top-level keys of AppSettings — the unit of "default vs overridden". */
export type AppSettingsKey = keyof AppSettings;

/** GET/PATCH/POST-reset /api/settings response. */
export interface AppSettingsResponse {
  settings: AppSettings;       // effective = persisted overrides merged over config defaults
  defaults: AppSettings;       // the static config, for "reset" affordances and diffing
  overridden: AppSettingsKey[];// which top-level keys carry a persisted override
  updatedAt: string | null;    // when the override row was last written
}

/** PATCH /api/settings body — any subset; each present key replaces wholesale. */
export type AppSettingsPatch = Partial<AppSettings>;

/** POST /api/settings/recompute response. */
export interface RecomputeResult {
  updated: number;      // datasets rescored with the effective settings
  skipped: number;      // datasets without a stored breakdown (FAILED/PROCESSING)
  tagsUpdated: number;  // non-overridden classification tags re-mapped to the sensitivity map
}

/** GET /api/system — health, connectivity, provider state, caps, versions. */
export interface SystemStatus {
  api: { status: "ok"; service: string; env: string; uptimeSeconds: number };
  database: { connected: boolean; latencyMs: number | null; datasetCount: number | null };
  llm: { state: "configured" | "regex-fallback"; model: string };
  ingestion: {
    maxUploadMb: number;      // env-driven (MAX_UPLOAD_MB)
    sampleRowsCap: number;    // preview rows persisted per dataset
    sampleValuesCap: number;  // distinct example values persisted per column
    classifySampleSize: number; // values sampled per column for value-pattern matching
    aiSampleSize: number;     // values sent to the LLM for an ambiguous column
    xlsxFirstSheetOnly: true;
  };
  versions: { api: string; node: string; prisma: string };
}

/** POST /api/data/reseed and DELETE /api/data/datasets. */
export interface DataMutationResult { datasets: number }
