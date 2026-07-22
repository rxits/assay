// Typed API client + TanStack Query hooks (10 §3.3).
//
// The API base URL (no /api suffix) is injected at build time via VITE_API_URL
// (09 §4); we compose /api/... paths from it. Every success body is unwrapped
// from its { data } / { data, meta } envelope (04 §1.2); every 4xx/5xx is thrown
// as a typed ApiClientError carrying the { error } contract (04 §1.3).
import { useSyncExternalStore } from "react";
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
  AppSettingsPatch,
  AppSettingsResponse,
  CatalogQuery,
  ClassificationOverrideResponse,
  DatasetDetail,
  DataMutationResult,
  DatasetOverview,
  DatasetSummary,
  FieldError,
  HealthResponse,
  PiiCategory,
  RecomputeResult,
  Sensitivity,
  SystemStatus,
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

// ---- Admin token --------------------------------------------------------
//
// Destructive calls carry an `x-admin-token` header. It is an operator secret, so it is held
// in sessionStorage and nowhere else: never localStorage (which survives on disk, indefinitely,
// on a shared machine), never a cookie (sent automatically, everywhere), never a query string
// (logged by every proxy in between). Closing the tab is the logout.
//
// Same store shape as lib/preferences.ts — a module value read through useSyncExternalStore,
// so the non-React `http` path and the React input see one source of truth.
const ADMIN_TOKEN_KEY = "assay-admin-token";
const adminListeners = new Set<() => void>();

function readAdminToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
  } catch {
    return ""; // private mode / storage disabled — the field still works for this page load
  }
}

let adminToken = readAdminToken();

export const getAdminToken = (): string => adminToken;

export function setAdminToken(value: string): void {
  // Trimmed on the way in: a pasted secret drags whitespace far more often than a token contains it.
  const next = value.trim();
  if (next === adminToken) return;
  adminToken = next;
  try {
    if (next) sessionStorage.setItem(ADMIN_TOKEN_KEY, next);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* best effort — the in-memory value still authorises this tab */
  }
  for (const l of adminListeners) l();
}

function subscribeAdminToken(cb: () => void): () => void {
  adminListeners.add(cb);
  return () => {
    adminListeners.delete(cb);
  };
}

export function useAdminToken(): string {
  return useSyncExternalStore(subscribeAdminToken, getAdminToken, getAdminToken);
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

/** GET /api/overview — catalog-wide aggregate for the dashboard home (R1.2). */
export async function getOverview(): Promise<DatasetOverview> {
  const body = await http<ApiSuccess<DatasetOverview>>("/api/overview");
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

// ---- Settings + system (R3) ---------------------------------------------

// Every call built through this helper is one the API's admin gate covers, so the token rides
// along here rather than at each call site — a new gated endpoint gets it for free.
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: {
    ...(adminToken ? { "x-admin-token": adminToken } : {}),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export async function getSettings(): Promise<AppSettingsResponse> {
  return (await http<ApiSuccess<AppSettingsResponse>>("/api/settings")).data;
}

export async function patchSettings(patch: AppSettingsPatch): Promise<AppSettingsResponse> {
  return (await http<ApiSuccess<AppSettingsResponse>>("/api/settings", json("PATCH", patch))).data;
}

export async function resetSettings(): Promise<AppSettingsResponse> {
  return (await http<ApiSuccess<AppSettingsResponse>>("/api/settings/reset", json("POST"))).data;
}

export async function recomputeScores(): Promise<RecomputeResult> {
  return (await http<ApiSuccess<RecomputeResult>>("/api/settings/recompute", json("POST"))).data;
}

export async function getSystem(): Promise<SystemStatus> {
  return (await http<ApiSuccess<SystemStatus>>("/api/system")).data;
}

export async function reseedDemoData(): Promise<DataMutationResult> {
  return (await http<ApiSuccess<DataMutationResult>>("/api/data/reseed", json("POST"))).data;
}

export async function deleteAllDatasets(): Promise<DataMutationResult> {
  return (await http<ApiSuccess<DataMutationResult>>("/api/data/datasets", json("DELETE"))).data;
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
  overview: () => ["overview"] as const,
  settings: () => ["settings"] as const,
  system: () => ["system"] as const,
};

/** Every score-bearing view. Re-scoring or reseeding invalidates all of them at once. */
function invalidateCatalog(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ["datasets"] });
  void qc.invalidateQueries({ queryKey: ["dataset"] });
  void qc.invalidateQueries({ queryKey: ["overview"] });
  void qc.invalidateQueries({ queryKey: ["usage"] });
}

export function useOverview() {
  return useQuery({
    queryKey: queryKeys.overview(),
    queryFn: getOverview,
  });
}

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
      void qc.invalidateQueries({ queryKey: ["overview"] });
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
      void qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

// ---- Settings hooks -----------------------------------------------------

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings(), queryFn: getSettings });
}

export function useSystem() {
  return useQuery({
    queryKey: queryKeys.system(),
    queryFn: getSystem,
    // The uptime/latency readout is a diagnostic — a minute-old answer is a wrong answer.
    refetchInterval: 30_000,
  });
}

export function usePatchSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patchSettings,
    onSuccess: (data) => qc.setQueryData(queryKeys.settings(), data),
  });
}

export function useResetSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: resetSettings,
    onSuccess: (data) => qc.setQueryData(queryKeys.settings(), data),
  });
}

export function useRecomputeScores() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: recomputeScores, onSuccess: () => invalidateCatalog(qc) });
}

export function useReseedDemoData() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: reseedDemoData, onSuccess: () => invalidateCatalog(qc) });
}

export function useDeleteAllDatasets() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: deleteAllDatasets, onSuccess: () => invalidateCatalog(qc) });
}
