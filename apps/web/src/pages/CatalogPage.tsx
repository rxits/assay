// Catalog page — 05 §6a. Top bar (title + Upload + theme toggle), a filter row
// (sensitivity / recommendation / sort → ?query), the sortable table (desktop)
// with a stacked-card fallback (<768px), plus designed skeleton / empty / error
// states (05 §5.4). No free-text search: the list API exposes no `q` (04 §1.6).
import { useState, type ReactNode } from "react";
import { Inbox, Upload } from "lucide-react";
import type { CatalogQuery, Sensitivity, ValueRecommendation } from "@assay/shared";
import { CatalogTable } from "@/components/catalog/CatalogTable";
import { DatasetCard } from "@/components/catalog/DatasetCard";
import { UploadDropzone } from "@/components/catalog/UploadDropzone";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useDatasets } from "@/lib/api";

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "-uploadedAt", label: "Newest" },
  { value: "uploadedAt", label: "Oldest" },
  { value: "name", label: "Name A–Z" },
  { value: "-qualityScore", label: "Quality (high→low)" },
  { value: "-trustScore", label: "Trust (high→low)" },
  { value: "-valueScore", label: "Value (high→low)" },
  { value: "-rowCount", label: "Largest" },
];

const SENSITIVITIES: Sensitivity[] = ["NONE", "LOW", "MEDIUM", "HIGH"];
const RECOMMENDATIONS: ValueRecommendation[] = ["KEEP", "OPTIMIZE", "ARCHIVE", "RETIRE"];

export function CatalogPage() {
  const [sort, setSort] = useState("-uploadedAt");
  const [sensitivity, setSensitivity] = useState<Sensitivity | "">("");
  const [recommendation, setRecommendation] = useState<ValueRecommendation | "">("");
  const [showUpload, setShowUpload] = useState(false);

  const query: CatalogQuery = {
    sort,
    sensitivity: sensitivity || undefined,
    recommendation: recommendation || undefined,
  };
  const { data, isLoading, isError, error, isFetching, refetch } = useDatasets(query);
  const datasets = data?.data ?? [];
  const total = data?.meta.total ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
          <span className="text-[15px] font-semibold tracking-tight">assay</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowUpload((v) => !v)}
              aria-expanded={showUpload}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Upload aria-hidden="true" className="h-4 w-4" />
              Upload dataset
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[24px] font-semibold tracking-tight">Catalog</h1>
          <span className="text-[14px] text-muted-foreground">
            · {total} {total === 1 ? "dataset" : "datasets"}
          </span>
        </div>

        {showUpload && (
          <div className="mt-4">
            <UploadDropzone onUploaded={() => void refetch()} />
          </div>
        )}

        {/* Filter row — 05 §6a. Native selects: accessible, keyboardable, no dep. */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Filter label="Sensitivity" value={sensitivity} onChange={(v) => setSensitivity(v as Sensitivity | "")}>
            <option value="">All</option>
            {SENSITIVITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Filter>
          <Filter label="Recommendation" value={recommendation} onChange={(v) => setRecommendation(v as ValueRecommendation | "")}>
            <option value="">All</option>
            {RECOMMENDATIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Filter>
          <Filter label="Sort" value={sort} onChange={setSort}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Filter>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <TableSkeleton />
          ) : isError ? (
            <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => void refetch()} />
          ) : datasets.length === 0 ? (
            <EmptyState onUpload={() => setShowUpload(true)} />
          ) : (
            <>
              <div className="hidden md:block">
                <CatalogTable datasets={datasets} sort={sort} onSortChange={setSort} dimmed={isFetching} />
              </div>
              <div className="flex flex-col gap-3 md:hidden">
                {datasets.map((d) => (
                  <DatasetCard key={d.id} dataset={d} />
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-input bg-card px-2 py-1.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </select>
    </label>
  );
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="h-10 border-b border-border bg-muted/50" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="ml-auto h-8 w-8 animate-pulse rounded-full bg-muted" />
          <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
          <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
          <div className="h-5 w-20 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card px-6 py-16 text-center">
      <Inbox aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
      <p className="text-[15px] font-medium">No datasets yet</p>
      <p className="max-w-sm text-[13px] text-muted-foreground">
        Upload a CSV or XLSX file to profile its structure, classify sensitive columns, and score its
        quality, trust and value.
      </p>
      <button
        type="button"
        onClick={onUpload}
        className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Upload aria-hidden="true" className="h-4 w-4" />
        Upload dataset
      </button>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-card px-6 py-16 text-center">
      <p className="text-[15px] font-medium">Couldn't load the catalog</p>
      <p className="max-w-sm text-[13px] text-muted-foreground">
        {message} The API may be waking from a cold start — retry in a moment.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-md border border-border px-3 py-2 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        Retry
      </button>
    </div>
  );
}
