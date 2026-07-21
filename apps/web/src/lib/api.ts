// Typed API client + TanStack Query hooks (10 §3.3).
//
// The API base URL (no /api suffix) is injected at build time via VITE_API_URL
// (09 §4); we compose /api/... paths from it. Every success body is unwrapped
// from its { data } / { data, meta } envelope (04 §1.2); every 4xx/5xx is thrown
// as a typed ApiClientError carrying the { error } contract (04 §1.3).
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ApiCollection,
  ApiError,
  ApiErrorCode,
  ApiSuccess,
  CatalogQuery,
  ClassificationOverrideResponse,
  DatasetDetail,
  DatasetSummary,
  FieldError,
  HealthResponse,
  PiiCategory,
  Sensitivity,
  UsageSeries,
} from "@assay/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** A failed request, carrying the API's stable error `code` (never a stack trace). */
export class ApiClientError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details?: FieldError[],
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function toClientError(status: number, body: unknown): ApiClientError {
  const err = (body as ApiError | null)?.error;
  return new ApiClientError(
    err?.code ?? "internal_error",
    err?.message ?? `Request failed (${status}).`,
    status,
    err?.details,
  );
}

/** Core fetch: unwrap the envelope on success, throw a typed error otherwise. */
async function http<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    // Network / CORS / cold-start failure — surfaced as the catalog error state.
    throw new ApiClientError("internal_error", "Couldn't reach the API.", 0);
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw toClientError(res.status, body);
  return body as T;
}

function buildQuery(q: CatalogQuery): string {
  const params = new URLSearchParams();
  if (q.limit != null) params.set("limit", String(q.limit));
  if (q.offset != null) params.set("offset", String(q.offset));
  if (q.sort) params.set("sort", q.sort);
  if (q.sensitivity) params.set("sensitivity", q.sensitivity);
  if (q.recommendation) params.set("recommendation", q.recommendation);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// ---- Endpoint functions -------------------------------------------------

export function health(): Promise<HealthResponse> {
  return http<HealthResponse>("/api/health");
}

/** GET /api/datasets — returns the full { data, meta } collection (04 §2.3). */
export function listDatasets(q: CatalogQuery = {}): Promise<ApiCollection<DatasetSummary>> {
  return http<ApiCollection<DatasetSummary>>(`/api/datasets${buildQuery(q)}`);
}

export async function getDataset(id: string): Promise<DatasetDetail> {
  const body = await http<ApiSuccess<DatasetDetail>>(`/api/datasets/${id}`);
  return body.data;
}

export async function getUsage(id: string, days?: number): Promise<UsageSeries> {
  const qs = days != null ? `?days=${days}` : "";
  const body = await http<ApiSuccess<UsageSeries>>(`/api/datasets/${id}/usage${qs}`);
  return body.data;
}

export interface UploadVars {
  file: File;
  name?: string;
  /** Determinate upload progress, 0→1 (05 §7). */
  onProgress?: (fraction: number) => void;
}

/** POST /api/datasets — multipart. Uses XHR (not fetch) for real upload progress. */
export function uploadDataset(vars: UploadVars): Promise<DatasetSummary> {
  const { file, name, onProgress } = vars;
  return new Promise<DatasetSummary>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/datasets`);
    xhr.responseType = "json";
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.upload.onload = () => onProgress(1);
    }
    xhr.onload = () => {
      const body = xhr.response as ApiSuccess<DatasetSummary> | ApiError | null;
      if (xhr.status >= 200 && xhr.status < 300 && body && "data" in body) {
        resolve(body.data);
      } else {
        reject(toClientError(xhr.status, body));
      }
    };
    xhr.onerror = () =>
      reject(new ApiClientError("internal_error", "Network error during upload.", 0));
    const fd = new FormData();
    fd.append("file", file);
    if (name) fd.append("name", name);
    xhr.send(fd);
  });
}

export interface OverrideVars {
  datasetId: string;
  columnId: string;
  category: PiiCategory;
  sensitivity?: Sensitivity;
}

export async function overrideClassification(
  vars: OverrideVars,
): Promise<ClassificationOverrideResponse> {
  const body = await http<ApiSuccess<ClassificationOverrideResponse>>(
    `/api/datasets/${vars.datasetId}/columns/${vars.columnId}/classification`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: vars.category, sensitivity: vars.sensitivity }),
    },
  );
  return body.data;
}

// ---- Query keys + hooks -------------------------------------------------

export const queryKeys = {
  datasets: (q: CatalogQuery) => ["datasets", q] as const,
  dataset: (id: string) => ["dataset", id] as const,
  usage: (id: string, days?: number) => ["usage", id, days ?? 90] as const,
};

export function useDatasets(query: CatalogQuery = {}) {
  return useQuery({
    queryKey: queryKeys.datasets(query),
    queryFn: () => listDatasets(query),
    // 05 §5.4 "refetch keeps the frame" — hold prior rows while a filter refetches.
    placeholderData: keepPreviousData,
  });
}

export function useDataset(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.dataset(id ?? ""),
    queryFn: () => getDataset(id as string),
    enabled: !!id,
  });
}

export function useUsage(id: string | undefined, days?: number) {
  return useQuery({
    queryKey: queryKeys.usage(id ?? "", days),
    queryFn: () => getUsage(id as string, days),
    enabled: !!id,
  });
}

export function useUploadDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: uploadDataset,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["datasets"] });
    },
  });
}

export function useOverrideClassification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: overrideClassification,
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.dataset(vars.datasetId) });
      void qc.invalidateQueries({ queryKey: ["datasets"] });
    },
  });
}
