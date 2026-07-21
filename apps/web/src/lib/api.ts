// Typed fetch client. Base URL is the API origin (no /api suffix) injected at
// build time via VITE_API_URL (09 §4); we compose /api/... paths from it.
import type { HealthResponse } from "@assay/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
};
