// Catalog page — 05 §6a, repainted onto the R1 premium glass system (R2.2).
// The AppShell owns all chrome now (brand, search, theme, upload), so this page
// renders only its own content: a title + live count, one glass filter strip
// (sensitivity / recommendation / sort → ?query), the sortable glass table
// (desktop) with a stacked-card fallback (<768px), an offset pager, and designed
// skeleton / empty / error states (05 §5.4). No free-text search: the list API
// exposes no `q` (04 §1.6).
import { useState, type ReactNode } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  ShieldHalf,
  SlidersHorizontal,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { CatalogQuery, Sensitivity, ValueRecommendation } from "@assay/shared";
import { CatalogTable } from "@/components/catalog/CatalogTable";
import { DatasetCard } from "@/components/catalog/DatasetCard";
import { UploadDropzone } from "@/components/catalog/UploadDropzone";
import { useDatasets } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { fadeUpItem, staggerContainer } from "@/lib/motion";
import { cn } from "@/lib/utils";

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
const PAGE_SIZE = 20; // matches the API's default limit (04 §1.6)

const GLASS_CARD = "glass rounded-xl border border-[color:var(--glass-border)]";

export function CatalogPage() {
  const reduce = useReducedMotion() ?? false;
  const [sort, setSort] = useState("-uploadedAt");
  const [sensitivity, setSensitivity] = useState<Sensitivity | "">("");
  const [recommendation, setRecommendation] = useState<ValueRecommendation | "">("");
  const [offset, setOffset] = useState(0);
  const [showUpload, setShowUpload] = useState(false);

  const query: CatalogQuery = {
    limit: PAGE_SIZE,
    offset,
    sort,
    sensitivity: sensitivity || undefined,
    recommendation: recommendation || undefined,
  };
  const { data, isLoading, isError, error, isFetching, refetch } = useDatasets(query);
  const datasets = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const filtered = sensitivity !== "" || recommendation !== "";

  // Any filter/sort change invalidates the current page window — go back to page 1.
  function reset<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setOffset(0);
    };
  }

  function clearFilters() {
    setSensitivity("");
    setRecommendation("");
    setOffset(0);
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-foreground">Catalog</h1>
          {/* One element, direct text children — the live dataset count. */}
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {formatCount(total)} {total === 1 ? "dataset" : "datasets"}
            {filtered ? " matching your filters" : " profiled, classified and scored"}
          </p>
        </div>
        {total > 0 && (
          <p className="text-[12px] tabular-nums text-muted-foreground">
            Showing {datasets.length === 0 ? 0 : offset + 1}–{offset + datasets.length} of {formatCount(total)}
          </p>
        )}
      </header>

      {showUpload && (
        <div className={cn(GLASS_CARD, "mb-4 p-4")}>
          <UploadDropzone onUploaded={() => void refetch()} />
        </div>
      )}

      {/* Filter strip — native selects: accessible, keyboardable, themed by color-scheme. */}
      <div className={cn(GLASS_CARD, "mb-4 flex flex-wrap items-center gap-2 p-2")}>
        <Filter
          icon={ShieldHalf}
          label="Sensitivity"
          value={sensitivity}
          active={sensitivity !== ""}
          onChange={reset((v: string) => setSensitivity(v as Sensitivity | ""))}
        >
          <option value="">All</option>
          {SENSITIVITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Filter>
        <Filter
          icon={SlidersHorizontal}
          label="Recommendation"
          value={recommendation}
          active={recommendation !== ""}
          onChange={reset((v: string) => setRecommendation(v as ValueRecommendation | ""))}
        >
          <option value="">All</option>
          {RECOMMENDATIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Filter>

        {filtered && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
            Clear
          </button>
        )}

        <div className="ml-auto">
          <Filter icon={ArrowDownUp} label="Sort" value={sort} active onChange={reset(setSort)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Filter>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState
          message={error instanceof Error ? error.message : "Something went wrong."}
          onRetry={() => void refetch()}
        />
      ) : datasets.length === 0 ? (
        <EmptyState filtered={filtered} onUpload={() => setShowUpload(true)} onClear={clearFilters} />
      ) : (
        <>
          <div className="hidden md:block">
            <CatalogTable datasets={datasets} sort={sort} onSortChange={reset(setSort)} dimmed={isFetching} />
          </div>
          <motion.div
            className="flex flex-col gap-3 md:hidden"
            variants={staggerContainer}
            initial={reduce ? false : "hidden"}
            animate="show"
          >
            {datasets.map((d) => (
              <DatasetCard key={d.id} dataset={d} />
            ))}
          </motion.div>

          {total > PAGE_SIZE && (
            <Pager
              offset={offset}
              count={datasets.length}
              total={total}
              busy={isFetching}
              onChange={setOffset}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---- Filter control ------------------------------------------------------
function Filter({
  icon: Icon,
  label,
  value,
  active,
  onChange,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  /** Tints the control when it is narrowing the list (or always, for Sort). */
  active?: boolean;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 transition-colors",
        "focus-within:ring-2 focus-within:ring-ring hover:bg-accent/50",
        active
          ? "border-primary/25 bg-primary/[0.07]"
          : "border-[color:var(--glass-border)] bg-background/35",
      )}
    >
      <Icon aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
      <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{label}</span>
      <span className="relative inline-flex items-center">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="cursor-pointer appearance-none bg-transparent pr-5 text-[13px] font-medium text-foreground outline-none"
        >
          {children}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-muted-foreground" />
      </span>
    </label>
  );
}

// ---- Pager ---------------------------------------------------------------
const PAGER_BTN =
  "inline-flex h-9 items-center gap-1 rounded-lg border border-[color:var(--glass-border)] bg-background/35 px-3 text-[13px] font-medium text-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40";

function Pager({
  offset,
  count,
  total,
  busy,
  onChange,
}: {
  offset: number;
  count: number;
  total: number;
  busy: boolean;
  onChange: (offset: number) => void;
}) {
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <nav aria-label="Catalog pages" className="mt-4 flex items-center justify-between gap-3">
      <span className="text-[12px] tabular-nums text-muted-foreground">
        Page {page} of {pages}
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          className={PAGER_BTN}
          disabled={offset === 0 || busy}
          onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          Previous
        </button>
        <button
          type="button"
          className={PAGER_BTN}
          disabled={offset + count >= total || busy}
          onClick={() => onChange(offset + PAGE_SIZE)}
        >
          Next
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </span>
    </nav>
  );
}

// ---- States --------------------------------------------------------------
function TableSkeleton() {
  return (
    <div className={cn(GLASS_CARD, "overflow-hidden")} aria-hidden="true">
      <div className="h-11 border-b border-[color:var(--glass-border)] bg-background/25" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-[color:var(--glass-border)] px-3 py-2.5 last:border-0"
        >
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

function EmptyState({
  filtered,
  onUpload,
  onClear,
}: {
  filtered: boolean;
  onUpload: () => void;
  onClear: () => void;
}) {
  return (
    <div className={cn(GLASS_CARD, "flex flex-col items-center gap-3 px-6 py-20 text-center")}>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/12 text-primary ring-1 ring-inset ring-primary/20">
        <Inbox aria-hidden="true" className="h-5 w-5" />
      </span>
      <p className="text-balance text-[16px] font-semibold text-foreground">
        {filtered ? "No datasets match these filters" : "No datasets yet"}
      </p>
      <p className="max-w-sm text-pretty text-[13px] text-muted-foreground">
        {filtered
          ? "Widen the sensitivity or recommendation filter to bring more of the catalog back into view."
          : "Upload a CSV or XLSX file to profile its structure, classify sensitive columns, and score its quality, trust and value."}
      </p>
      {filtered ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--glass-border)] px-3 py-2 text-[13px] font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden="true" className="h-4 w-4" />
          Clear filters
        </button>
      ) : (
        <button
          type="button"
          onClick={onUpload}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground outline-none transition-[opacity,transform] duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
        >
          <Upload aria-hidden="true" className="h-4 w-4" />
          Upload dataset
        </button>
      )}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <motion.div
      variants={fadeUpItem}
      initial="hidden"
      animate="show"
      className={cn(GLASS_CARD, "flex flex-col items-center gap-3 px-6 py-16 text-center")}
    >
      <p className="text-[15px] font-medium text-foreground">Couldn't load the catalog</p>
      <p className="max-w-sm text-pretty text-[13px] text-muted-foreground">
        {message} The API may be waking from a cold start — retry in a moment.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-lg border border-[color:var(--glass-border)] px-3 py-2 text-[13px] font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        Retry
      </button>
    </motion.div>
  );
}
