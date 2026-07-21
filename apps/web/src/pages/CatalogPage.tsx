import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Phase-0 shell: proves the web → API contract end-to-end by rendering
// GET /api/health through TanStack Query. The real catalog lands in Phase 3.
export function CatalogPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
  });

  return (
    <main className="min-h-screen bg-background font-sans text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-semibold tracking-tight">assay</h1>
          <span className="text-sm text-muted-foreground">Data Governance Dashboard</span>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            API status
          </h2>
          <div className="mt-3">
            {isLoading && <p className="text-muted-foreground">Checking API…</p>}
            {isError && (
              <p className="text-destructive">API unreachable — {(error as Error).message}</p>
            )}
            {data && (
              <div className="flex items-center gap-3">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full bg-primary"
                  aria-hidden="true"
                />
                <p>
                  <span className="font-medium">{data.service}</span> is{" "}
                  <span className="font-medium">{data.status}</span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {new Date(data.timestamp).toLocaleString()}
                  </span>
                </p>
              </div>
            )}
          </div>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          Catalog coming soon — Phase 1 wires upload, profiling, and scoring.
        </p>
      </section>
    </main>
  );
}
