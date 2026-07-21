// Dataset detail — 05 §6b, repainted onto the R1 premium glass system (R2.3).
// The AppShell owns the chrome, so this page opens on a breadcrumb back to the
// catalog, then: the identity header, the three ScoreGauges (each opening its
// "explain this score" breakdown — Trust's additionally surfaces Quality's own
// completeness/accuracy inputs), the AI health-narrative card (R6 placeholder when
// null), a columns table whose rows expand in place into a ColumnPanel, the usage
// area chart with its 30/90-day summary, and the type distribution. FAILED shows
// its errorMessage; PROCESSING shows a profiling state; loading + not-found are
// designed states (§5.4). Every surface is one glass card — never a card in a card.
import { useId, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Link, useParams } from "react-router-dom";
import type { ColumnDTO, DatasetDetail } from "@assay/shared";
import { MissingValueBar } from "@/components/charts/MissingValueBar";
import { ChartSkeleton } from "@/components/charts/chart-shell";
import { TypeDistribution } from "@/components/charts/TypeDistribution";
import { UsageChart } from "@/components/charts/UsageChart";
import { ColumnPanel } from "@/components/dataset/ColumnPanel";
import { ScoreBreakdown, type SubRows } from "@/components/dataset/ScoreBreakdown";
import { RecommendationBadge, SensitivityBadge } from "@/components/dataset/SensitivityBadge";
import { ApiClientError, useDataset, useUsage } from "@/lib/api";
import { formatBytes, formatCompact, formatCount, formatPct, relativeTime } from "@/lib/format";
import { fadeUpItem, staggerContainer } from "@/lib/motion";
import { Toaster } from "@/lib/toast";
import { cn } from "@/lib/utils";

const GLASS_CARD = "glass rounded-xl border border-[color:var(--glass-border)]";

export function DatasetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useDataset(id);
  const usageQuery = useUsage(id);

  const notFound = error instanceof ApiClientError && error.code === "dataset_not_found";

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8">
      <Breadcrumb name={data?.name} />
      {isLoading && <DetailSkeleton />}
      {isError &&
        (notFound ? (
          <NotFound />
        ) : (
          <ErrorState message={error instanceof Error ? error.message : "Couldn't load this dataset."} />
        ))}
      {data && (
        <Detail data={data} usage={usageQuery.data ?? data.usage} usageLoading={usageQuery.isLoading && !data.usage} />
      )}
      <Toaster />
    </div>
  );
}

/** Where-am-I trail. The shell's rail marks the section; this names the record. */
function Breadcrumb({ name }: { name?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex min-w-0 items-center gap-1 text-[13px]">
      <Link
        to="/catalog"
        className="rounded-md px-1 py-0.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        Catalog
      </Link>
      <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      <span className="min-w-0 truncate text-foreground">{name ?? "…"}</span>
    </nav>
  );
}

function Detail({
  data,
  usage,
  usageLoading,
}: {
  data: DatasetDetail;
  usage: DatasetDetail["usage"];
  usageLoading: boolean;
}) {
  const reduce = useReducedMotion() ?? false;
  const sb = data.scoreBreakdown;

  // Trust is defined over quality, completeness, accuracy, consistency and
  // classification status, but folds the first three into one weighted `quality`
  // term. Surface Quality's own inputs beneath that row so every named factor is
  // visible — display only; the weights and the formula are untouched.
  const trustSubRows: SubRows | undefined = sb
    ? {
        under: "quality",
        caption: "Quality inputs",
        items: [
          { label: "Completeness", value: sb.quality.inputs.completeness },
          { label: "Accuracy (validity)", value: sb.quality.inputs.validity },
        ],
      }
    : undefined;

  return (
    <motion.div
      className="flex flex-col gap-4"
      variants={staggerContainer}
      initial={reduce ? false : "hidden"}
      animate="show"
    >
      <motion.header variants={fadeUpItem}>
        <h1 className="text-balance text-[24px] font-semibold tracking-tight text-foreground">{data.name}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
          <span>{data.fileType}</span>
          <Dot />
          <span>
            <span className="tabular-nums">{formatCount(data.rowCount)}</span> rows
          </span>
          <Dot />
          <span>
            <span className="tabular-nums">{formatCount(data.columnCount)}</span> cols
          </span>
          <Dot />
          <span>{formatBytes(data.sizeBytes)}</span>
          <Dot />
          <span>
            uploaded{" "}
            <time dateTime={data.uploadedAt} title={data.uploadedAt}>
              {relativeTime(data.uploadedAt)}
            </time>
          </span>
          <Dot />
          <span className="font-mono text-[11px] uppercase tracking-[0.05em]">{data.originalFilename}</span>
        </div>
      </motion.header>

      {data.status === "FAILED" ? (
        <FailedCard message={data.errorMessage} />
      ) : data.status === "PROCESSING" ? (
        <motion.div variants={fadeUpItem} className={cn(GLASS_CARD, "p-6")}>
          <div className="assay-indeterminate mb-3 h-1 w-40 overflow-hidden rounded-full bg-muted" aria-hidden="true" />
          <p className="text-[14px] text-muted-foreground">Profiling… scores appear once processing completes.</p>
        </motion.div>
      ) : (
        <>
          {/* Scores — each gauge opens its ScoreBreakdown popover (05 §4.5). */}
          <motion.section
            variants={fadeUpItem}
            aria-label="Scores"
            className={cn(GLASS_CARD, "flex flex-wrap items-start gap-x-6 gap-y-4 p-6")}
          >
            <ScoreBreakdown label="Quality" score={data.qualityScore} status={data.status} entry={sb?.quality ?? null} />
            <ScoreBreakdown
              label="Trust"
              score={data.trustScore}
              status={data.status}
              entry={sb?.trust ?? null}
              subRows={trustSubRows}
            />
            <ScoreBreakdown label="Value" score={data.valueScore} status={data.status} entry={sb?.value ?? null} />
            <div className="ml-auto flex flex-col items-start gap-3">
              <div className="flex flex-col gap-2">
                <Caption>Recommendation</Caption>
                <RecommendationBadge value={data.valueRecommendation} />
              </div>
              <div className="flex flex-col gap-2">
                <Caption>Top sensitivity</Caption>
                <SensitivityBadge level={data.highestSensitivity} />
              </div>
            </div>
          </motion.section>

          <HealthNarrative narrative={data.healthNarrative} />

          <div className="grid gap-4 lg:grid-cols-3">
            <motion.section variants={fadeUpItem} className="lg:col-span-2" aria-label="Columns">
              <SectionHeader>Columns ({data.columns.length})</SectionHeader>
              <ColumnsTable data={data} />
            </motion.section>

            <div className="flex flex-col gap-4">
              <motion.section variants={fadeUpItem} aria-label="Usage">
                <SectionHeader>Usage</SectionHeader>
                <div className={cn(GLASS_CARD, "p-4")}>
                  <UsageSummary
                    total={data.accessCount}
                    last30={usage.summary.accessesLast30}
                    prev30={usage.summary.accessesPrev30}
                    d90={usage.summary.accesses90d}
                  />
                  <div className="mt-3">
                    {usageLoading ? <ChartSkeleton height={200} /> : <UsageChart usage={usage} />}
                  </div>
                </div>
              </motion.section>

              <motion.section variants={fadeUpItem} aria-label="Type distribution">
                <SectionHeader>Type distribution</SectionHeader>
                <div className={cn(GLASS_CARD, "p-4")}>
                  <TypeDistribution columns={data.columns} />
                </div>
              </motion.section>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}

/**
 * Usage headline above the daily series — the same access events the Value score
 * reads, stated as numbers. The 30-day delta is the Trend input made legible;
 * direction is carried by an arrow and a signed number, never by colour alone.
 */
function UsageSummary({
  total,
  last30,
  prev30,
  d90,
}: {
  total: number;
  last30: number;
  prev30: number;
  d90: number;
}) {
  const delta = last30 - prev30;
  const Arrow = delta < 0 ? TrendingDown : TrendingUp;
  const tone = delta < 0 ? "--status-warning" : "--status-good";
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="flex items-baseline gap-1.5">
        <Eye aria-hidden="true" className="h-4 w-4 self-center text-muted-foreground" />
        <span className="text-[24px] font-bold leading-none tabular-nums text-foreground">{formatCompact(total)}</span>
        <span className="text-[12px] text-muted-foreground">total views</span>
      </div>
      <div className="flex items-center gap-3 text-[12px] tabular-nums text-muted-foreground">
        <span>{formatCompact(d90)} in 90d</span>
        <span aria-hidden="true" className="h-3 w-px bg-border" />
        <span className="inline-flex items-center gap-1">
          {delta !== 0 && <Arrow aria-hidden="true" className="h-3.5 w-3.5" style={{ color: `var(${tone})` }} />}
          {delta > 0 ? "+" : ""}
          {formatCount(delta)} vs prior 30d
        </span>
      </div>
    </div>
  );
}

function ColumnsTable({ data }: { data: DatasetDetail }) {
  // Only one panel open at a time keeps the page scannable (05 §7).
  const [openId, setOpenId] = useState<string | null>(null);
  // ponytail: expand controls are real <button>s (Tab/Enter/Space operable) with
  // aria-expanded/-controls, rather than a full arrow-key roving-tabindex grid —
  // matching the catalog table's precedent. Add roving nav only if AT users ask.
  return (
    <div className={cn(GLASS_CARD, "overflow-hidden")}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-[color:var(--glass-border)] bg-background/25">
              <Th align="right">#</Th>
              <Th align="left">Name</Th>
              <Th align="left">Type</Th>
              <Th align="left">Missing</Th>
              <Th align="right">Distinct</Th>
              <Th align="right">Validity</Th>
              <Th align="left">Sensitivity</Th>
              <Th align="right">
                <span className="sr-only">Expand</span>
              </Th>
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
        className="group cursor-pointer border-b border-[color:var(--glass-border)] transition-colors last:border-0 hover:bg-accent/45 data-[open=true]:bg-accent/60"
        data-open={open}
      >
        <td className="relative px-3 py-2.5 text-right tabular-nums text-muted-foreground">
          {/* Spring accent rail, shared language with the catalog table. */}
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-y-1.5 left-0 w-[2px] origin-center rounded-full bg-primary transition-transform duration-200 [transition-timing-function:var(--ease-spring)] group-hover:scale-y-100",
              open ? "scale-y-100" : "scale-y-0",
            )}
          />
          {column.position}
        </td>
        <td className="px-3 py-2.5 font-mono font-medium text-foreground">{column.name}</td>
        <td className="px-3 py-2.5 text-[12px] uppercase tracking-[0.05em] text-muted-foreground">{column.dataType}</td>
        <td className="px-3 py-2.5" style={{ minWidth: 120 }}>
          <MissingValueBar pct={column.missingPct} severity={missingCheck?.severity} />
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatCount(column.distinctCount)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatPct(column.validity)}</td>
        <td className="px-3 py-2.5">
          <SensitivityBadge level={tag?.sensitivity ?? null} size="sm" overridden={tag?.overridden} />
        </td>
        <td className="px-3 py-2.5 text-right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? "Collapse" : "Expand"} ${column.name} detail`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              aria-hidden="true"
              className="h-4 w-4 transition-transform duration-200 [transition-timing-function:var(--ease-spring)] data-[open=true]:rotate-180"
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
    <motion.section
      variants={fadeUpItem}
      aria-label="Health narrative"
      className={cn(GLASS_CARD, "flex items-start gap-3 p-4")}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary ring-1 ring-inset ring-primary/20">
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
      </span>
      {narrative ? (
        <p className="text-pretty text-[14px] leading-relaxed text-foreground">{narrative}</p>
      ) : (
        // R6 (10 §0): AI layer is optional — a neutral placeholder, never an error.
        <p className="text-pretty text-[14px] leading-relaxed text-muted-foreground">
          Narrative unavailable — scores are computed deterministically.
        </p>
      )}
    </motion.section>
  );
}

function FailedCard({ message }: { message: string | null }) {
  return (
    <motion.div
      variants={fadeUpItem}
      className="glass flex items-start gap-3 rounded-xl border p-6"
      style={{ borderColor: "color-mix(in srgb, var(--status-critical) 40%, transparent)" }}
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--status-critical)]" />
      <div>
        <p className="text-[15px] font-medium text-foreground">This dataset failed to process</p>
        <p className="mt-1 text-pretty text-[13px] text-muted-foreground">
          {message ?? "No further detail was recorded."}
        </p>
      </div>
    </motion.div>
  );
}

// ---- Small primitives ----------------------------------------------------
function Dot() {
  return <span aria-hidden="true">·</span>;
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{children}</span>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-[15px] font-semibold tracking-tight text-foreground">{children}</h2>;
}

const HEADER_CLASS = "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground";
function Th({ children, align }: { children: ReactNode; align: "left" | "right" }) {
  return (
    <th scope="col" className={`${HEADER_CLASS} ${align === "right" ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

// ---- States --------------------------------------------------------------
function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div>
        <div className="h-7 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-80 animate-pulse rounded bg-muted" />
      </div>
      <div className={cn(GLASS_CARD, "flex gap-6 p-6")}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[132px] w-[132px] animate-pulse rounded-full bg-muted" />
        ))}
      </div>
      <div className={cn(GLASS_CARD, "h-20")} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className={cn(GLASS_CARD, "h-64 lg:col-span-2")} />
        <div className={cn(GLASS_CARD, "h-64")} />
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className={cn(GLASS_CARD, "flex flex-col items-center gap-3 px-6 py-20 text-center")}>
      <p className="text-[16px] font-semibold text-foreground">Dataset not found</p>
      <p className="max-w-sm text-pretty text-[13px] text-muted-foreground">
        It may have been removed, or the link is out of date.
      </p>
      <Link
        to="/catalog"
        className="mt-1 rounded-lg border border-[color:var(--glass-border)] px-3 py-2 text-[13px] font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to catalog
      </Link>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className={cn(GLASS_CARD, "flex flex-col items-center gap-3 px-6 py-16 text-center")}>
      <p className="text-[15px] font-medium text-foreground">Couldn't load this dataset</p>
      <p className="max-w-sm text-pretty text-[13px] text-muted-foreground">
        {message} The API may be waking from a cold start.
      </p>
    </div>
  );
}
