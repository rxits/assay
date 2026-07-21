// Dataset detail — 05 §6b. Header + the three ScoreGauges (each opening its
// "explain this score" breakdown), the AI health-narrative card (R6 placeholder
// when null), a columns table whose rows expand in place into a ColumnPanel, the
// full-size usage chart, and the type distribution. FAILED shows its errorMessage;
// PROCESSING shows a profiling state; loading + not-found are designed states (§5.4).
import { useId, useState } from "react";
import { ChevronDown, ChevronLeft, Sparkles, TriangleAlert } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type { ColumnDTO, DatasetDetail } from "@assay/shared";
import { MissingValueBar } from "@/components/charts/MissingValueBar";
import { ChartSkeleton } from "@/components/charts/chart-shell";
import { TypeDistribution } from "@/components/charts/TypeDistribution";
import { UsageChart } from "@/components/charts/UsageChart";
import { ColumnPanel } from "@/components/dataset/ColumnPanel";
import { ScoreBreakdown } from "@/components/dataset/ScoreBreakdown";
import { RecommendationBadge, SensitivityBadge } from "@/components/dataset/SensitivityBadge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ApiClientError, useDataset, useUsage } from "@/lib/api";
import { formatBytes, formatCount, formatPct, relativeTime } from "@/lib/format";
import { Toaster } from "@/lib/toast";

export function DatasetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useDataset(id);
  const usageQuery = useUsage(id);

  const notFound = error instanceof ApiClientError && error.code === "dataset_not_found";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1 rounded-sm text-[14px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            Catalog
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        {isLoading && <DetailSkeleton />}
        {isError && (notFound ? <NotFound /> : <ErrorState message={error instanceof Error ? error.message : "Couldn't load this dataset."} />)}
        {data && <Detail data={data} usage={usageQuery.data ?? data.usage} usageLoading={usageQuery.isLoading && !data.usage} />}
      </main>
      <Toaster />
    </div>
  );
}

function Detail({ data, usage, usageLoading }: { data: DatasetDetail; usage: DatasetDetail["usage"]; usageLoading: boolean }) {
  const sb = data.scoreBreakdown;
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-[24px] font-semibold tracking-tight">{data.name}</h1>
        <span className="text-[14px] text-muted-foreground">
          {data.fileType} · {formatCount(data.rowCount)} rows · {formatCount(data.columnCount)} cols
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {data.originalFilename} · {formatBytes(data.sizeBytes)} · uploaded{" "}
        <time dateTime={data.uploadedAt} title={data.uploadedAt}>{relativeTime(data.uploadedAt)}</time> · status{" "}
        {data.status}
      </p>

      {data.status === "FAILED" ? (
        <FailedCard message={data.errorMessage} />
      ) : data.status === "PROCESSING" ? (
        <div className="mt-6 rounded-lg border border-border bg-card p-6 text-[14px] text-muted-foreground">
          Profiling… scores appear once processing completes.
        </div>
      ) : (
        <>
          {/* Scores — each gauge opens its ScoreBreakdown popover (05 §4.5). */}
          <section
            aria-label="Scores"
            className="mt-6 flex flex-wrap items-start gap-6 rounded-lg border border-border bg-card p-6 shadow-xs"
          >
            <ScoreBreakdown label="Quality" score={data.qualityScore} status={data.status} entry={sb?.quality ?? null} />
            <ScoreBreakdown label="Trust" score={data.trustScore} status={data.status} entry={sb?.trust ?? null} />
            <ScoreBreakdown label="Value" score={data.valueScore} status={data.status} entry={sb?.value ?? null} />
            <div className="ml-auto flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                Recommendation
              </span>
              <RecommendationBadge value={data.valueRecommendation} />
            </div>
          </section>

          <HealthNarrative narrative={data.healthNarrative} />

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <SectionHeader>Columns ({data.columns.length})</SectionHeader>
              <ColumnsTable data={data} />
            </div>
            <div className="flex flex-col gap-6">
              <div>
                <SectionHeader>Usage · views/day</SectionHeader>
                <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
                  {usageLoading ? <ChartSkeleton height={200} /> : <UsageChart usage={usage} />}
                </div>
              </div>
              <div>
                <SectionHeader>Type distribution</SectionHeader>
                <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
                  <TypeDistribution columns={data.columns} />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function ColumnsTable({ data }: { data: DatasetDetail }) {
  // Only one panel open at a time keeps the page scannable (05 §7).
  const [openId, setOpenId] = useState<string | null>(null);
  // ponytail: expand controls are real <button>s (Tab/Enter/Space operable) with
  // aria-expanded/-controls, rather than a full arrow-key roving-tabindex grid —
  // matching the catalog table's precedent. Add roving nav only if AT users ask.
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-xs">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-border">
            <Th align="right">#</Th>
            <Th align="left">Name</Th>
            <Th align="left">Type</Th>
            <Th align="left">Missing</Th>
            <Th align="right">Distinct</Th>
            <Th align="right">Validity</Th>
            <Th align="left">Sensitivity</Th>
            <Th align="right"><span className="sr-only">Expand</span></Th>
          </tr>
        </thead>
        <tbody>
          {data.columns.map((col) => (
            <ColumnRow
              key={col.id}
              datasetId={data.id}
              column={col}
              checks={data.qualityChecks.filter((c) => c.columnId === col.id)}
              open={openId === col.id}
              onToggle={() => setOpenId((cur) => (cur === col.id ? null : col.id))}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColumnRow({
  datasetId,
  column,
  checks,
  open,
  onToggle,
}: {
  datasetId: string;
  column: ColumnDTO;
  checks: DatasetDetail["qualityChecks"];
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = useId();
  const tag = column.classificationTag;
  const missingCheck = checks.find((c) => c.checkType === "MISSING_VALUES");
  return (
    <>
      <tr
        onClick={onToggle}
        className="group cursor-pointer border-b border-border transition-colors hover:bg-accent last:border-0 data-[open=true]:bg-accent"
        data-open={open}
      >
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{column.position}</td>
        <td className="px-3 py-2 font-mono font-medium text-foreground">{column.name}</td>
        <td className="px-3 py-2 text-[12px] uppercase tracking-[0.04em] text-muted-foreground">{column.dataType}</td>
        <td className="px-3 py-2" style={{ minWidth: 120 }}>
          <MissingValueBar pct={column.missingPct} severity={missingCheck?.severity} />
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCount(column.distinctCount)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatPct(column.validity)}</td>
        <td className="px-3 py-2">
          <SensitivityBadge level={tag?.sensitivity ?? null} size="sm" overridden={tag?.overridden} />
        </td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? "Collapse" : "Expand"} ${column.name} detail`}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              aria-hidden="true"
              className="h-4 w-4 transition-transform data-[open=true]:rotate-180"
              data-open={open}
            />
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="p-0">
            <div id={panelId} role="region" aria-label={`${column.name} detail`}>
              <ColumnPanel datasetId={datasetId} column={column} checks={checks} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function HealthNarrative({ narrative }: { narrative: string | null }) {
  return (
    <section aria-label="Health narrative" className="mt-6 flex items-start gap-2.5 rounded-lg border border-border bg-card p-4 shadow-xs">
      <Sparkles aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[color:hsl(var(--primary))]" />
      {narrative ? (
        <p className="text-[14px] leading-relaxed text-foreground">{narrative}</p>
      ) : (
        // R6 (10 §0): AI layer is optional — a neutral placeholder, never an error.
        <p className="text-[14px] leading-relaxed text-muted-foreground">
          Narrative unavailable — scores are computed deterministically.
        </p>
      )}
    </section>
  );
}

function FailedCard({ message }: { message: string | null }) {
  return (
    <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-[color:var(--status-critical)] bg-card p-6 shadow-xs">
      <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--status-critical)]" />
      <div>
        <p className="text-[15px] font-medium text-foreground">This dataset failed to process</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{message ?? "No further detail was recorded."}</p>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-[18px] font-semibold tracking-tight">{children}</h2>;
}

const HEADER_CLASS = "px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground";
function Th({ children, align }: { children: React.ReactNode; align: "left" | "right" }) {
  return (
    <th scope="col" className={`${HEADER_CLASS} ${align === "right" ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function DetailSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-7 w-64 rounded bg-muted" />
      <div className="mt-2 h-4 w-80 rounded bg-muted" />
      <div className="mt-6 flex gap-6 rounded-lg border border-border bg-card p-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[132px] w-[132px] rounded-full bg-muted" />
        ))}
      </div>
      <div className="mt-6 h-20 rounded-lg border border-border bg-card" />
      <div className="mt-6 h-64 rounded-lg border border-border bg-card" />
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-16 text-center">
      <p className="text-[15px] font-medium">Dataset not found</p>
      <p className="max-w-sm text-[13px] text-muted-foreground">
        It may have been removed, or the link is out of date.
      </p>
      <Link
        to="/"
        className="mt-1 rounded-md border border-border px-3 py-2 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to catalog
      </Link>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-16 text-center">
      <p className="text-[15px] font-medium">Couldn't load this dataset</p>
      <p className="max-w-sm text-[13px] text-muted-foreground">
        {message} The API may be waking from a cold start.
      </p>
    </div>
  );
}
