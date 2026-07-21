# 04 — API Design (assay)

> Purpose: the authoritative HTTP contract for the `assay` API. **Derived from 00-SPEC.md** — routes (§7), entities/fields (§6), enums (§6/§8), and formulas (§9) all trace back there; this doc adds only wire-level detail (status codes, request/response bodies, validation). If anything here contradicts 00-SPEC, 00-SPEC wins.

---

## 1. Conventions

### 1.1 Base path & transport
- **Base path:** `/api` (no version segment — single-version take-home; versioning is a documented non-need, see §5).
- **Transport:** JSON over HTTP. Requests and responses are `application/json; charset=utf-8`, **except** `POST /api/datasets`, whose request is `multipart/form-data` (response is still JSON).
- **Timestamps:** ISO-8601 UTC (`2026-07-21T14:32:05.000Z`). **IDs:** cuid strings (e.g. `clv3k2h8x0000abcd1234efgh`). **Enum values:** `UPPER_SNAKE`, exactly as 00-SPEC §6/§8.
- **No auth, no rate limiting, no CORS allowlist beyond the deployed web origin** — per 00-SPEC §12 (non-goals). Every route is public.

### 1.2 Response envelope
One rule across every endpoint (health excepted):

| Outcome | Shape |
|---|---|
| Success (single resource) | `{ "data": <object> }` |
| Success (collection) | `{ "data": [ ... ], "meta": { ...pagination } }` |
| Error (any 4xx/5xx) | `{ "error": { "code", "message", "details?" } }` |

`GET /api/health` is the **one exemption** — it returns a flat body so dumb liveness probes can read it without unwrapping.

The success `data` wrapper is symmetric with the spec-mandated `error` wrapper (00-SPEC §7) and gives the catalog list a home for `meta`. It is one rule applied uniformly, not per-endpoint special-casing.

### 1.3 Canonical error shape (00-SPEC §7)

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed.",
    "details": [
      { "field": "sensitivity", "message": "Must be one of NONE, LOW, MEDIUM, HIGH.", "code": "invalid_enum" }
    ]
  }
}
```

- `code` — stable machine-readable slug (lowercase `snake_case`); clients branch on this, never on `message`.
- `message` — human-readable, safe to surface in the UI. **Never** leaks stack traces, SQL, or file-system paths (00-SPEC §2; api-design "does not leak internal details").
- `details?` — optional array of field-level problems; present for validation errors, omitted otherwise.

### 1.4 HTTP status-code policy

| Code | When |
|---|---|
| `200 OK` | Successful `GET` / `PATCH` / `POST …/reprofile` with a body |
| `201 Created` | `POST /api/datasets` succeeded — dataset row created (status `READY` **or** `FAILED`); `Location: /api/datasets/:id` header set |
| `204 No Content` | `DELETE` succeeded (no body) |
| `400 Bad Request` | Malformed JSON, missing multipart file field |
| `404 Not Found` | Dataset or column id does not exist (or column not under that dataset) |
| `413 Payload Too Large` | Upload exceeds the size cap (see §2.2) |
| `415 Unsupported Media Type` | Uploaded file is not CSV/XLSX |
| `422 Unprocessable Entity` | Well-formed request, semantically invalid: bad enum value, empty/zero-row/zero-column file, unparseable file |
| `500 Internal Server Error` | Unexpected server fault only — **never** returned for bad uploaded data (that path yields a `FAILED` dataset at 201, see §2.2/§3) |

Design rule: a broken *dataset* is a first-class catalog citizen (status `FAILED`, graceful — 00-SPEC §11 sample 5), never an HTTP 500. 500 is reserved for genuine server bugs.

### 1.5 Error-code registry

| `code` | HTTP | Meaning |
|---|---|---|
| `malformed_json` | 400 | Body is not valid JSON |
| `missing_file` | 400 | `multipart/form-data` had no `file` field |
| `unsupported_file_type` | 415 | File is neither `.csv` nor `.xlsx` |
| `file_too_large` | 413 | File exceeds `MAX_UPLOAD_BYTES` |
| `empty_file` | 422 | 0 bytes, or parsed to 0 data rows / 0 columns |
| `invalid_file` | 422 | File could not be parsed at all (corrupt / not tabular) |
| `validation_error` | 422 | Invalid field value (enum, type) in body or query |
| `dataset_not_found` | 404 | No dataset with that id |
| `column_not_found` | 404 | No column with that id under that dataset |
| `internal_error` | 500 | Unexpected server fault |

### 1.6 Pagination, filtering & sorting (catalog list)

Applies to `GET /api/datasets`. **Offset pagination** — the catalog is an admin view over a handful of datasets, so offset (jump-to-page, trivially implemented) beats cursor (api-design §Pagination: "admin dashboards, small datasets → offset").

| Param | Type | Default | Notes |
|---|---|---|---|
| `limit` | int 1–100 | `20` | Clamped to 100; out-of-range → `422 validation_error` |
| `offset` | int ≥ 0 | `0` | |
| `sort` | enum (see below) | `-uploadedAt` | `-` prefix = descending |
| `sensitivity` | `Sensitivity` | — | Keep datasets having **≥1 column** tagged at this sensitivity |
| `recommendation` | `ValueRecommendation` | — | Filter on `Dataset.valueRecommendation` |

**Allowed `sort` keys:** `uploadedAt`, `name`, `qualityScore`, `trustScore`, `valueScore`, `rowCount` — each with optional `-` prefix. Unknown key or unknown enum value → `422 validation_error`. Null scores sort last regardless of direction (a `PROCESSING`/`FAILED` dataset never outranks a scored one).

`meta` block for collections:

```json
{ "total": 42, "limit": 20, "offset": 0, "count": 20 }
```

`status` and free-text `q` filters are trivial future additions on the same pattern; omitted now (00-SPEC §7 names only `sort`/`sensitivity`/`recommendation`).

---

## 2. Endpoint reference

Nine routes total (00-SPEC §7). `:id` = dataset cuid, `:columnId` = column cuid.

### 2.1 `GET /api/health` — liveness

Pure liveness (process is up). Does **not** touch the DB — readiness/DB-ping is out of scope for a deploy health check.

**Request:** none.
**Success `200` (flat, envelope-exempt):**
```json
{ "status": "ok", "service": "assay-api", "timestamp": "2026-07-21T14:32:05.000Z" }
```
**Statuses:** `200` only.

---

### 2.2 `POST /api/datasets` — upload → full pipeline → summary

Accepts one CSV/XLSX file, runs the ingestion pipeline **inline** (00-SPEC §12: no job queue — parse → profile → classify → score synchronously), persists profiles + scores, and returns the dataset **summary** (not the full nested detail — that is `GET /:id`).

**Request:** `multipart/form-data`

| Part | Type | Required | Notes |
|---|---|---|---|
| `file` | file | yes | multer `.single("file")` — exactly one file |
| `name` | text | no | Overrides the dataset name; defaults to the original filename (`Dataset.name`, 00-SPEC §6) |

**Accepted files:**
- CSV — extension `.csv`; MIME `text/csv`, `application/vnd.ms-excel`, `application/octet-stream` (browsers are inconsistent, so extension is the primary signal).
- XLSX — extension `.xlsx`; MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
- Anything else → `415 unsupported_file_type` (rejected in the multer `fileFilter`, before any row is written).

**Size limit:** `MAX_UPLOAD_BYTES = 10 MiB` (`10 * 1024 * 1024`), enforced via multer `limits.fileSize`. On overflow multer raises `LIMIT_FILE_SIZE` → mapped to **`413 file_too_large`**. This is the "cap oversized files" guard from 00-SPEC §3; combined with stream-parsing and storing only aggregates (00-SPEC §6 storage decision), it keeps large files safe.

**Pipeline & status transitions:**
1. Up-front validation (presence, type, size, non-empty, ≥1 column, ≥1 data row). Any failure → 4xx, **no row created** (see §3).
2. Create `Dataset` with `status = PROCESSING`.
3. Stream-parse → profile columns → classify (regex/heuristics, optional AI for ambiguous columns per 00-SPEC §8) → compute Quality/Trust/Value (00-SPEC §9) → `status = READY`.
4. If a downstream step throws unexpectedly (e.g. a corrupt XLSX that passed the up-front check), persist `status = FAILED` + `errorMessage` and **return the FAILED summary at `201`** — never a 500. The dataset stays in the catalog as a graceful failure (00-SPEC §11 sample 5).

**Success `201 Created`** — `Location: /api/datasets/clv3k2h8x0000abcd1234efgh`

```json
{
  "data": {
    "id": "clv3k2h8x0000abcd1234efgh",
    "name": "customers",
    "originalFilename": "customers.csv",
    "fileType": "CSV",
    "sizeBytes": 48213,
    "rowCount": 1000,
    "columnCount": 5,
    "status": "READY",
    "qualityScore": 98.9,
    "trustScore": 98.6,
    "valueScore": 68.7,
    "valueRecommendation": "KEEP",
    "piiColumnCount": 3,
    "highestSensitivity": "HIGH",
    "lastAccessedAt": null,
    "errorMessage": null,
    "uploadedAt": "2026-07-21T14:32:05.000Z",
    "updatedAt": "2026-07-21T14:32:06.310Z"
  }
}
```

**FAILED example (still `201`, in-pipeline fault):**
```json
{
  "data": {
    "id": "clv3k2p110001abcd5678ijkl",
    "name": "broken",
    "originalFilename": "broken.csv",
    "fileType": "CSV",
    "sizeBytes": 291,
    "rowCount": 0,
    "columnCount": 0,
    "status": "FAILED",
    "qualityScore": null,
    "trustScore": null,
    "valueScore": null,
    "valueRecommendation": null,
    "piiColumnCount": 0,
    "highestSensitivity": null,
    "lastAccessedAt": null,
    "errorMessage": "Row 4 has 7 fields; header declares 5. File is not rectangular.",
    "uploadedAt": "2026-07-21T14:33:10.000Z",
    "updatedAt": "2026-07-21T14:33:10.220Z"
  }
}
```

**Errors:** `400 missing_file` · `400 malformed_json` (bad multipart) · `413 file_too_large` · `415 unsupported_file_type` · `422 empty_file` · `422 invalid_file` · `500 internal_error`.

---

### 2.3 `GET /api/datasets` — catalog list

Paginated, filterable, sortable list of dataset summaries powering the catalog table (counts, tags, quality/trust/value, usage — 00-SPEC §3 area 7). No access event recorded (catalog browsing is not a `DETAIL_VIEW`).

**Query params:** see §1.6.

**Example:** `GET /api/datasets?sensitivity=HIGH&sort=-trustScore&limit=2&offset=0`

**Success `200`:**
```json
{
  "data": [
    {
      "id": "clv3k2h8x0000abcd1234efgh",
      "name": "customers",
      "originalFilename": "customers.csv",
      "fileType": "CSV",
      "sizeBytes": 48213,
      "rowCount": 1000,
      "columnCount": 5,
      "status": "READY",
      "qualityScore": 98.9,
      "trustScore": 98.6,
      "valueScore": 68.7,
      "valueRecommendation": "KEEP",
      "piiColumnCount": 3,
      "highestSensitivity": "HIGH",
      "lastAccessedAt": "2026-07-21T14:40:11.000Z",
      "errorMessage": null,
      "uploadedAt": "2026-07-21T14:32:05.000Z",
      "updatedAt": "2026-07-21T14:40:11.050Z"
    },
    {
      "id": "clv3k3aaa0002abcd9012mnop",
      "name": "employees",
      "originalFilename": "employees.xlsx",
      "fileType": "XLSX",
      "sizeBytes": 20591,
      "rowCount": 220,
      "columnCount": 8,
      "status": "READY",
      "qualityScore": 91.4,
      "trustScore": 89.2,
      "valueScore": 22.5,
      "valueRecommendation": "ARCHIVE",
      "piiColumnCount": 4,
      "highestSensitivity": "HIGH",
      "lastAccessedAt": "2026-07-10T09:12:00.000Z",
      "errorMessage": null,
      "uploadedAt": "2026-07-19T11:02:00.000Z",
      "updatedAt": "2026-07-19T11:02:01.900Z"
    }
  ],
  "meta": { "total": 5, "limit": 2, "offset": 0, "count": 2 }
}
```

**Empty catalog:** `200` with `{ "data": [], "meta": { "total": 0, "limit": 20, "offset": 0, "count": 0 } }`.
**Errors:** `422 validation_error` (bad `sort`/`sensitivity`/`recommendation`/`limit`/`offset`).

---

### 2.4 `GET /api/datasets/:id` — full detail (**records `DETAIL_VIEW`**)

Returns the complete nested view: columns (with tags), quality checks, score breakdown, health narrative, and the usage series.

**Side effect (00-SPEC §7, §10):** each call inserts an `AccessEvent { type: DETAIL_VIEW, source: LIVE, occurredAt: now }`, then **recomputes Value** (frequency/recency/trend → `valueScore` + `valueRecommendation`) from all access events and appends a `ScoreSnapshot`. This makes `GET` deliberately non-safe — access-logging *is* the Data Value signal, so it is spec-mandated, not accidental. Optional **`?track=false`** suppresses the event and recompute (for the frontend's own background refetch and for tests, so measurement isn't polluted); default is `true` (spec behavior).

**Path param:** `id` (dataset cuid).

**Success `200`** (abridged to 3 of 5 columns for length; real payload lists every column):
```json
{
  "data": {
    "id": "clv3k2h8x0000abcd1234efgh",
    "name": "customers",
    "originalFilename": "customers.csv",
    "fileType": "CSV",
    "sizeBytes": 48213,
    "rowCount": 1000,
    "columnCount": 5,
    "status": "READY",
    "qualityScore": 98.9,
    "trustScore": 98.6,
    "valueScore": 68.7,
    "valueRecommendation": "KEEP",
    "healthNarrative": "High-quality customer table: near-complete, well-typed, and consistently formatted. Three high-sensitivity PII columns (email, phone, name) are fully classified. Steady access over the last 90 days keeps its value high — recommend KEEP.",
    "errorMessage": null,
    "uploadedAt": "2026-07-21T14:32:05.000Z",
    "updatedAt": "2026-07-21T14:40:11.050Z",
    "scoreBreakdown": {
      "quality": {
        "score": 98.9,
        "inputs": { "completeness": 0.98, "validity": 0.99, "uniqueness": 1.0 },
        "weights": { "completeness": 0.40, "validity": 0.30, "uniqueness": 0.30 }
      },
      "trust": {
        "score": 98.6,
        "inputs": { "quality": 0.989, "consistency": 0.97, "classificationCoverage": 1.0 },
        "weights": { "quality": 0.45, "consistency": 0.30, "classificationCoverage": 0.25 }
      },
      "value": {
        "score": 68.7,
        "inputs": { "frequency": 0.62, "recency": 0.85, "trend": 0.55 },
        "weights": { "frequency": 0.45, "recency": 0.35, "trend": 0.20 },
        "raw": { "accesses90d": 34, "accessesLast30": 12, "accessesPrev30": 9, "daysSinceLastAccess": 0, "freqCap": 50, "halfLife": 30 }
      }
    },
    "columns": [
      {
        "id": "clv3k2col00001abcd0001aaaa",
        "name": "email",
        "position": 0,
        "dataType": "STRING",
        "missingCount": 3,
        "missingPct": 0.003,
        "distinctCount": 997,
        "completeness": 0.997,
        "validity": 0.999,
        "sampleValues": ["ada@example.com", "grace@example.com", "linus@example.com"],
        "classificationTag": {
          "id": "clv3k2tag00001abcd0001tttt",
          "category": "EMAIL",
          "sensitivity": "HIGH",
          "source": "AUTO_REGEX",
          "confidence": 0.99,
          "overridden": false,
          "createdAt": "2026-07-21T14:32:06.000Z",
          "updatedAt": "2026-07-21T14:32:06.000Z"
        }
      },
      {
        "id": "clv3k2col00002abcd0002bbbb",
        "name": "full_name",
        "position": 2,
        "dataType": "STRING",
        "missingCount": 0,
        "missingPct": 0.0,
        "distinctCount": 986,
        "completeness": 1.0,
        "validity": 1.0,
        "sampleValues": ["Ada Lovelace", "Grace Hopper", "Linus Torvalds"],
        "classificationTag": {
          "id": "clv3k2tag00002abcd0002uuuu",
          "category": "NAME",
          "sensitivity": "MEDIUM",
          "source": "AUTO_AI",
          "confidence": 0.82,
          "overridden": false,
          "createdAt": "2026-07-21T14:32:06.000Z",
          "updatedAt": "2026-07-21T14:32:06.000Z"
        }
      },
      {
        "id": "clv3k2col00003abcd0003cccc",
        "name": "country",
        "position": 4,
        "dataType": "STRING",
        "missingCount": 21,
        "missingPct": 0.021,
        "distinctCount": 47,
        "completeness": 0.979,
        "validity": 1.0,
        "sampleValues": ["US", "IN", "DE"],
        "classificationTag": {
          "id": "clv3k2tag00003abcd0003vvvv",
          "category": "NONE",
          "sensitivity": "NONE",
          "source": "AUTO_REGEX",
          "confidence": null,
          "overridden": false,
          "createdAt": "2026-07-21T14:32:06.000Z",
          "updatedAt": "2026-07-21T14:32:06.000Z"
        }
      }
    ],
    "qualityChecks": [
      {
        "id": "clv3k2qc000001abcd0001qqqq",
        "columnId": "clv3k2col00003abcd0003cccc",
        "checkType": "MISSING_VALUES",
        "severity": "WARNING",
        "affectedCount": 21,
        "affectedPct": 0.021,
        "detail": "Column \"country\" is missing 21 of 1000 values (2.1%).",
        "createdAt": "2026-07-21T14:32:06.000Z"
      },
      {
        "id": "clv3k2qc000002abcd0002rrrr",
        "columnId": null,
        "checkType": "DUPLICATE_ROWS",
        "severity": "INFO",
        "affectedCount": 0,
        "affectedPct": 0.0,
        "detail": "No duplicate rows detected.",
        "createdAt": "2026-07-21T14:32:06.000Z"
      }
    ],
    "usage": {
      "datasetId": "clv3k2h8x0000abcd1234efgh",
      "from": "2026-04-22",
      "to": "2026-07-21",
      "series": [
        { "date": "2026-07-19", "total": 2, "byType": { "VIEW": 1, "DETAIL_VIEW": 1, "DOWNLOAD": 0 } },
        { "date": "2026-07-20", "total": 3, "byType": { "VIEW": 2, "DETAIL_VIEW": 1, "DOWNLOAD": 0 } },
        { "date": "2026-07-21", "total": 1, "byType": { "VIEW": 0, "DETAIL_VIEW": 1, "DOWNLOAD": 0 } }
      ],
      "summary": { "accesses90d": 34, "accessesLast30": 12, "accessesPrev30": 9, "lastAccessedAt": "2026-07-21T14:40:11.000Z" }
    }
  }
}
```

**Notes:**
- `sampleRows` (00-SPEC §6, capped ≤50) is available but omitted from this example; include it as `data.sampleRows` when the UI needs a raw preview table.
- A `FAILED` dataset returns `200` with `status: "FAILED"`, `errorMessage` set, and empty `columns`/`qualityChecks` arrays.

**Errors:** `404 dataset_not_found` · `422 validation_error` (bad `track` value) · `500 internal_error`.

---

### 2.5 `PATCH /api/datasets/:id/columns/:columnId/classification` — manual override

Applies a **manual** classification tag to one column (00-SPEC §3 area 3: "manual override required"). Upserts the column's 1:1 `ClassificationTag` with `source = MANUAL`, `overridden = true`, `confidence = null` (a human decision is not a model match-share).

**Path params:** `id` (dataset), `columnId` (must belong to that dataset, else `404 column_not_found`).

**Request body:**
```json
{ "category": "EMAIL", "sensitivity": "MEDIUM" }
```
| Field | Type | Required | Notes |
|---|---|---|---|
| `category` | `PiiCategory` | yes | 00-SPEC §8 |
| `sensitivity` | `Sensitivity` | no | If omitted, defaults to the category's default sensitivity (00-SPEC §8 table). If present, wins — lets a reviewer down/up-rank a category for a given dataset |

**What recomputes (00-SPEC §9):** the tag change alters `classifiedColumns` → **`ClassificationCoverage = classifiedColumns / columnCount`** → **Trust** (`0.45·Quality + 0.30·Consistency + 0.25·ClassificationCoverage`). **Quality is untouched** (independent of classification) and **Value is untouched** (usage-only). A column resolved to explicit `NONE` still counts as classified (00-SPEC §8), so overriding *to* `NONE` can *raise* coverage. A fresh `ScoreSnapshot` is appended.

**Success `200`** — returns the updated column (with its new tag) plus the recomputed dataset scores so the UI updates the Trust gauge without a refetch:
```json
{
  "data": {
    "column": {
      "id": "clv3k2col00003abcd0003cccc",
      "name": "country",
      "position": 4,
      "dataType": "STRING",
      "missingCount": 21,
      "missingPct": 0.021,
      "distinctCount": 47,
      "completeness": 0.979,
      "validity": 1.0,
      "sampleValues": ["US", "IN", "DE"],
      "classificationTag": {
        "id": "clv3k2tag00003abcd0003vvvv",
        "category": "POSTAL_CODE",
        "sensitivity": "LOW",
        "source": "MANUAL",
        "confidence": null,
        "overridden": true,
        "createdAt": "2026-07-21T14:32:06.000Z",
        "updatedAt": "2026-07-21T14:45:30.000Z"
      }
    },
    "dataset": {
      "id": "clv3k2h8x0000abcd1234efgh",
      "trustScore": 98.6,
      "qualityScore": 98.9,
      "valueScore": 68.7,
      "scoreBreakdown": {
        "trust": {
          "score": 98.6,
          "inputs": { "quality": 0.989, "consistency": 0.97, "classificationCoverage": 1.0 },
          "weights": { "quality": 0.45, "consistency": 0.30, "classificationCoverage": 0.25 }
        }
      },
      "updatedAt": "2026-07-21T14:45:30.100Z"
    }
  }
}
```

**Errors:** `400 malformed_json` · `404 dataset_not_found` · `404 column_not_found` (unknown column, or column not under this dataset) · `422 validation_error` (missing/invalid `category`, invalid `sensitivity`) · `500 internal_error`.

---

### 2.6 `GET /api/datasets/:id/usage` — daily access time-series

Powers the Data Value chart (Recharts). Same payload as the `usage` block embedded in §2.4, exposed standalone so the chart can refetch without re-pulling the whole detail. **No access event recorded** (a sub-read of the value data is not itself a `DETAIL_VIEW`).

**Path param:** `id`. **Query params:**
| Param | Type | Default | Notes |
|---|---|---|---|
| `days` | int 1–365 | `90` | Trailing window; buckets are **zero-filled** so the chart has no gaps |
| `type` | `AccessType` | — | Optional single-type filter (`VIEW`/`DETAIL_VIEW`/`DOWNLOAD`) |

**Success `200`:**
```json
{
  "data": {
    "datasetId": "clv3k2h8x0000abcd1234efgh",
    "from": "2026-04-22",
    "to": "2026-07-21",
    "series": [
      { "date": "2026-07-19", "total": 2, "byType": { "VIEW": 1, "DETAIL_VIEW": 1, "DOWNLOAD": 0 } },
      { "date": "2026-07-20", "total": 3, "byType": { "VIEW": 2, "DETAIL_VIEW": 1, "DOWNLOAD": 0 } },
      { "date": "2026-07-21", "total": 1, "byType": { "VIEW": 0, "DETAIL_VIEW": 1, "DOWNLOAD": 0 } }
    ],
    "summary": { "accesses90d": 34, "accessesLast30": 12, "accessesPrev30": 9, "lastAccessedAt": "2026-07-21T14:40:11.000Z" }
  }
}
```

**Errors:** `404 dataset_not_found` · `422 validation_error` (bad `days`/`type`) · `500 internal_error`.

---

### 2.7 `POST /api/datasets/:id/reprofile` — recompute scores (optional)

Recomputes Quality/Trust/Value **from persisted profiles** (per-column aggregates + stored `sampleValues`) and current access events, optionally re-runs the AI `healthNarrative`, and appends a `ScoreSnapshot`. It does **not** re-parse the file — raw rows are not retained (00-SPEC §6 storage decision), so this refreshes scores, not the raw profile. Useful after tuning scoring weights or backfilling seed access events.

**Path param:** `id`. **Request body:** none (or `{}`).

**Success `200`** — returns the refreshed dataset summary (same shape as §2.2 `data`).
**Errors:** `404 dataset_not_found` · `422 validation_error` (reprofiling a `FAILED` dataset with no stored profile) · `500 internal_error`.

---

### 2.8 `DELETE /api/datasets/:id` — remove dataset (optional)

Deletes the dataset and all children (`columns`, `classificationTags`, `qualityChecks`, `accessEvents`, `scoreSnapshots`) via FK cascade (00-SPEC §6).

**Path param:** `id`. **Success `204 No Content`** (empty body).
**Errors:** `404 dataset_not_found` · `500 internal_error`.

---

## 3. Validation rules & edge-case matrix

Guarding principle: **client-correctable, up-front-detectable problems are 4xx with no row created; a problem only discoverable mid-pipeline yields a `FAILED` dataset at 201; bad data never yields 500.**

| Case | Detected | Response |
|---|---|---|
| No `file` part in multipart | up-front | `400 missing_file` |
| Malformed multipart / JSON body | up-front | `400 malformed_json` |
| File > 10 MiB | multer limit | `413 file_too_large` |
| `.txt` / `.json` / image / other | `fileFilter` | `415 unsupported_file_type` |
| 0-byte file | up-front | `422 empty_file` |
| Header row but **0 data rows** | post-parse, pre-insert | `422 empty_file` (scoring divides by `rowCount`; refuse rather than divide-by-zero) |
| Parses to **0 columns** | post-parse, pre-insert | `422 empty_file` |
| Corrupt / non-tabular bytes (unparseable) | post-parse, pre-insert | `422 invalid_file` |
| **Duplicate headers** | in-pipeline | `201 READY` — recorded as `QualityCheck DUPLICATE_HEADER`, penalizes Consistency (00-SPEC §9). Not a failure |
| **Ragged rows** (varying field counts) | in-pipeline | `201 READY` — short rows null-padded, extra fields dropped; `TYPE_MISMATCH`/consistency penalty. Not a failure |
| Blank/empty column | in-pipeline | `201 READY` — `QualityCheck EMPTY_COLUMN`, `completeness = 0` |
| Corrupt XLSX that passed extension check but SheetJS cannot open | in-pipeline throw | `201` with `status: FAILED` + `errorMessage` (graceful, catalogued) |
| Unknown dataset/column id | route | `404 dataset_not_found` / `404 column_not_found` |
| Invalid enum in body/query | validation | `422 validation_error` with `details[]` |
| Unexpected server fault | runtime | `500 internal_error` (generic message; no internals leaked) |

**Field-level rules:** `limit` ∈ [1,100]; `offset` ≥ 0; `days` ∈ [1,365]; `category` ∈ `PiiCategory`; `sensitivity` ∈ `Sensitivity`; `sort`/`sensitivity`/`recommendation`/`type` must be allowed values. Violations → `422 validation_error` with a `details` entry per bad field. Validation is centralized (one schema layer, e.g. zod) so every route rejects consistently before touching a service.

---

## 4. Shared DTOs (`packages/shared`)

TypeScript, imported by **both** `apps/api` and `apps/web` (00-SPEC §5). Enums mirror 00-SPEC §6/§8 exactly. Using string-literal union types (not TS `enum`) keeps them structurally identical to Prisma's generated enum strings and safe to send over the wire.

```typescript
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
  | "dataset_not_found" | "column_not_found" | "internal_error";

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

export interface HealthResponse {
  status: "ok";
  service: string;
  timestamp: string;
}
```

---

## 5. Divergences from 00-SPEC

**None material.** All nine routes, entity/field names, enums, and formulas are used exactly as 00-SPEC §6–§9 define them. Wire-level choices that 00-SPEC left open, resolved here (all additive, none contradict the spec):

- **No `/v1` version segment** — base path is `/api` exactly (00-SPEC §7). Versioning is a documented non-need for a single-shot take-home (api-design "don't version until you need to").
- **Offset pagination** (`limit`/`offset`) added to the catalog list — 00-SPEC §7 names only `sort`/`sensitivity`/`recommendation`, but the task requires pagination; offset fits an admin catalog of a few datasets.
- **`?track=false`** on `GET /:id` and **`days`/`type`** on `GET …/usage` are optional params whose **defaults preserve the exact §7 behavior** (tracking on; 90-day full series). Purely additive controls to prevent measurement pollution / shape the chart.
- Success responses use a `{ data }` / `{ data, meta }` envelope (00-SPEC fixes only the `{ error }` shape); `GET /health` is intentionally flat for probes.
