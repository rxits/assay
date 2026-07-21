// DashboardPage (R1.3) — the premium overview home at "/". A genuine dashboard:
// KPI stat tiles, a recommendation donut, a sensitivity/PII-exposure strip, a
// quality-vs-value small-multiples, a "needs attention" table and a recent-uploads
// list — all glass cards with a staggered spring entrance. Charts follow dataviz:
// the validated score ramp (sequential magnitude) and the reserved status hues
// (always paired with an icon+word legend, never colour-alone), one axis each,
// recessive chrome, and designed skeleton/empty states. Data: useOverview() +
// useDatasets(). Every figure drills through to /datasets/:id.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipProps } from "recharts";
import { motion, useReducedMotion } from "motion/react";
import { Database, Inbox, ShieldAlert, ShieldCheck, TriangleAlert, Upload } from "lucide-react";
import type { DatasetSummary, Sensitivity, ValueRecommendation } from "@assay/shared";
import { useDatasets, useOverview } from "@/lib/api";
import { scoreBand, scoreTier } from "@/components/dataset/ScoreGauge";
import { RecommendationBadge, SensitivityBadge } from "@/components/dataset/SensitivityBadge";
import { ChartEmpty } from "@/components/charts/chart-shell";
import { formatCompact, formatCount, relativeTime } from "@/lib/format";
import { fadeUpItem, staggerContainer } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Reserved status hues (05 §3.2–3.3) keyed by entity — colour follows the entity,
// never its rank; every use is paired with an icon+word badge in the legend.
const REC_ORDER: ValueRecommendation[] = ["KEEP", "OPTIMIZE", "ARCHIVE", "RETIRE"];
const REC_COLOR: Record<ValueRecommendation, string> = {
  KEEP: "var(--status-good)",
  OPTIMIZE: "var(--status-warning)",
  ARCHIVE: "var(--status-muted)",
  RETIRE: "var(--status-critical)",
};
const SENS_ORDER: Sensitivity[] = ["NONE", "LOW", "MEDIUM", "HIGH"];
const SENS_COLOR: Record<Sensitivity, string> = {
  NONE: "var(--status-muted)",
  LOW: "var(--status-good)",
  MEDIUM: "var(--status-warning)",
  HIGH: "var(--status-critical)",
};

const scoreFill = (score: number | null): string =>
  score == null ? "var(--gauge-track)" : `var(--score-band-${scoreBand(score)})`;

// ---- Card primitives -----------------------------------------------------
function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.section
      variants={fadeUpItem}
      className={cn("glass rounded-xl border border-[color:var(--glass-border)] p-5", className)}
    >
      {children}
    </motion.section>
  );
}

function CardTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
      {hint && <span className="text-[12px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

// ---- KPI stat tiles ------------------------------------------------------
function KpiTile({
  label,
  icon: Icon,
  value,
  suffix,
  children,
  tone,
}: {
  label: string;
  icon: typeof Database;
  value: string;
  suffix?: string;
  children?: ReactNode;
  tone?: "critical";
}) {
  return (
    <motion.div
      variants={fadeUpItem}
      className="glass flex flex-col gap-3 rounded-xl border border-[color:var(--glass-border)] p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {label}
        </span>
        <Icon
          aria-hidden="true"
          className={cn("h-4 w-4", tone === "critical" ? "text-[color:var(--status-critical)]" : "text-muted-foreground")}
          strokeWidth={2}
        />
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[30px] font-bold leading-none tabular-nums text-foreground">{value}</span>
        {suffix && <span className="text-[13px] text-muted-foreground">{suffix}</span>}
      </div>
      {children}
    </motion.div>
  );
}

/** A slim 0–100 magnitude bar (score ramp). Reused by the avg-score tiles. */
function ScoreMeter({ score }: { score: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--gauge-track)" }}>
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: scoreFill(score) }}
      />
    </div>
  );
}

/** A proportional composition strip (2px surface gaps). Shared by status + sensitivity. */
function CompositionStrip({
  segments,
  height = "h-2",
}: {
  segments: { key: string; value: number; color: string }[];
  height?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div className={cn("flex w-full gap-0.5 overflow-hidden rounded-full", height)}>
      {total === 0 ? (
        <div className="h-full w-full" style={{ background: "var(--gauge-track)" }} />
      ) : (
        segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div key={s.key} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.key}: ${s.value}`} />
          ))
      )}
    </div>
  );
}

// ---- Recommendation donut ------------------------------------------------
function RecTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as { key: string; value: number; pct: number } | undefined;
  if (!row) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-[13px] shadow-md">
      <span className="font-medium text-foreground">{row.key}</span>
      <span className="tabular-nums text-muted-foreground"> · {row.value} ({Math.round(row.pct * 100)}%)</span>
    </div>
  );
}

function RecommendationDonut({
  distribution,
  reduce,
}: {
  distribution: Record<ValueRecommendation, number>;
  reduce: boolean;
}) {
  const total = REC_ORDER.reduce((a, r) => a + distribution[r], 0);
  const data = REC_ORDER.map((r) => ({ key: r, value: distribution[r], pct: total ? distribution[r] / total : 0 })).filter(
    (d) => d.value > 0,
  );

  return (
    <Card>
      <CardTitle title="Recommendations" hint={total ? `${total} scored` : undefined} />
      {total === 0 ? (
        <ChartEmpty icon={Database} message="No scored datasets yet" height={200} />
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          <div
            className="relative shrink-0"
            role="img"
            aria-label={`Value recommendations — ${data.map((d) => `${d.value} ${d.key}`).join(", ")}`}
          >
            <ResponsiveContainer width={168} height={168}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="key"
                  innerRadius={54}
                  outerRadius={78}
                  paddingAngle={data.length > 1 ? 2 : 0}
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                  isAnimationActive={!reduce}
                  startAngle={90}
                  endAngle={-270}
                >
                  {data.map((d) => (
                    <Cell key={d.key} fill={REC_COLOR[d.key]} />
                  ))}
                </Pie>
                <Tooltip content={<RecTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[26px] font-bold leading-none tabular-nums text-foreground">{total}</span>
              <span className="text-[11px] text-muted-foreground">datasets</span>
            </div>
          </div>
          <ul className="flex w-full flex-col gap-2">
            {REC_ORDER.map((r) => (
              <li key={r} className="flex items-center justify-between gap-2">
                <RecommendationBadge value={r} size="sm" />
                <span className="tabular-nums text-[13px] font-medium text-foreground">{distribution[r]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ---- Sensitivity / PII exposure -----------------------------------------
function SensitivityExposure({
  distribution,
  piiColumnCount,
  totalColumns,
}: {
  distribution: Record<Sensitivity, number>;
  piiColumnCount: number;
  totalColumns: number;
}) {
  const classified = SENS_ORDER.reduce((a, s) => a + distribution[s], 0);
  return (
    <Card>
      <CardTitle title="PII exposure" hint={classified ? `${classified} classified cols` : undefined} />
      {classified === 0 ? (
        <ChartEmpty icon={ShieldCheck} message="No classified columns yet" height={200} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-baseline gap-2">
            <span className="text-[30px] font-bold leading-none tabular-nums text-foreground">
              {formatCount(piiColumnCount)}
            </span>
            <span className="text-[13px] text-muted-foreground">
              PII-bearing {piiColumnCount === 1 ? "column" : "columns"} of {formatCount(totalColumns)}
            </span>
          </div>
          <div role="img" aria-label={`Sensitivity spread — ${SENS_ORDER.map((s) => `${distribution[s]} ${s}`).join(", ")}`}>
            <CompositionStrip
              height="h-2.5"
              segments={SENS_ORDER.map((s) => ({ key: s, value: distribution[s], color: SENS_COLOR[s] }))}
            />
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {SENS_ORDER.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <SensitivityBadge level={s} size="sm" />
                <span className="tabular-nums text-[13px] font-medium text-foreground">{distribution[s]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ---- Quality vs Value small-multiples ------------------------------------
function QualityValueMultiples({ datasets }: { datasets: DatasetSummary[] }) {
  const ready = datasets
    .filter((d) => d.status === "READY" && d.qualityScore != null && d.valueScore != null)
    .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
    .slice(0, 6);

  return (
    <Card>
      <CardTitle title="Quality vs Value" hint="top datasets" />
      {ready.length === 0 ? (
        <ChartEmpty icon={Database} message="No scored datasets to compare" height={200} />
      ) : (
        <ul className="flex flex-col gap-3.5">
          {ready.map((d) => (
            <li key={d.id}>
              <Link
                to={`/datasets/${d.id}`}
                className="group flex flex-col gap-1.5 rounded-lg px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate text-[13px] font-medium text-foreground group-hover:underline">{d.name}</span>
                <MiniBar label="Q" score={d.qualityScore} />
                <MiniBar label="V" score={d.valueScore} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MiniBar({ label, score }: { label: string; score: number | null }) {
  const v = score ?? 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 shrink-0 text-[10px] font-semibold uppercase text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--gauge-track)" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: scoreFill(score) }} />
      </div>
      <span className="w-7 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{Math.round(v)}</span>
    </div>
  );
}

// ---- Needs attention -----------------------------------------------------
function NeedsAttention({
  items,
}: {
  items: { id: string; name: string; valueRecommendation: ValueRecommendation | null; status: string }[];
}) {
  return (
    <Card>
      <CardTitle title="Needs attention" hint={items.length ? `${items.length} flagged` : undefined} />
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <ShieldCheck aria-hidden="true" className="h-6 w-6 text-[color:var(--status-good)]" />
          <p className="text-[13px] text-muted-foreground">Nothing to retire and no failures — the catalog is healthy.</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((d) => (
            <li key={d.id}>
              <Link
                to={`/datasets/${d.id}`}
                className="group flex items-center justify-between gap-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex items-center gap-2">
                  <TriangleAlert
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-[color:var(--status-critical)]"
                  />
                  <span className="truncate text-[13px] font-medium text-foreground group-hover:underline">{d.name}</span>
                </span>
                {d.status === "FAILED" ? (
                  <span className="shrink-0 text-[12px] font-medium text-[color:var(--status-critical)]">Failed</span>
                ) : (
                  <RecommendationBadge value={d.valueRecommendation} size="sm" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---- Recent uploads ------------------------------------------------------
function RecentUploads({
  items,
}: {
  items: { id: string; name: string; uploadedAt: string; qualityScore: number | null }[];
}) {
  return (
    <Card>
      <CardTitle title="Recent uploads" />
      {items.length === 0 ? (
        <ChartEmpty icon={Inbox} message="No uploads yet" height={160} />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((d) => (
            <li key={d.id}>
              <Link
                to={`/datasets/${d.id}`}
                className="group flex items-center justify-between gap-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate text-[13px] font-medium text-foreground group-hover:underline">
                  {d.name}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {d.qualityScore != null ? (
                    <span className="tabular-nums text-[12px] text-muted-foreground">Q {Math.round(d.qualityScore)}</span>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">—</span>
                  )}
                  <time className="w-16 text-right text-[12px] text-muted-foreground" dateTime={d.uploadedAt} title={d.uploadedAt}>
                    {relativeTime(d.uploadedAt)}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---- States --------------------------------------------------------------
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="glass h-28 rounded-xl border border-[color:var(--glass-border)]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="glass h-56 animate-pulse rounded-xl border border-[color:var(--glass-border)]" />
        ))}
      </div>
    </div>
  );
}

function DashboardEmpty() {
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-xl border border-[color:var(--glass-border)] px-6 py-20 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/12 text-primary ring-1 ring-inset ring-primary/20">
        <Upload aria-hidden="true" className="h-5 w-5" />
      </span>
      <p className="text-[16px] font-semibold text-foreground">Your catalog is empty</p>
      <p className="max-w-sm text-pretty text-[13px] text-muted-foreground">
        Upload a CSV or XLSX to profile its structure, classify sensitive columns, and score its quality, trust and
        value. This overview fills in as datasets land.
      </p>
      <Link
        to="/catalog"
        className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Go to catalog
      </Link>
    </div>
  );
}

function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-xl border border-[color:var(--glass-border)] px-6 py-16 text-center">
      <p className="text-[15px] font-medium text-foreground">Couldn't load the overview</p>
      <p className="max-w-sm text-[13px] text-muted-foreground">{message} The API may be waking from a cold start.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-lg border border-border px-3 py-2 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        Retry
      </button>
    </div>
  );
}

// ---- Page ----------------------------------------------------------------
export function DashboardPage() {
  const reduce = useReducedMotion() ?? false;
  const overviewQ = useOverview();
  const datasetsQ = useDatasets({ sort: "-uploadedAt" });
  const o = overviewQ.data;

  const readySplit = o
    ? [
        { key: "READY", value: o.ready, color: "var(--status-good)" },
        { key: "PROCESSING", value: o.processing, color: "var(--status-warning)" },
        { key: "FAILED", value: o.failed, color: "var(--status-critical)" },
      ]
    : [];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8">
      <header className="mb-6">
        <h1 className="text-[24px] font-semibold tracking-tight text-foreground">Overview</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {o && o.totalDatasets > 0
            ? `${formatCount(o.totalDatasets)} ${o.totalDatasets === 1 ? "dataset" : "datasets"} · ${o.ready} ready · ${formatCount(o.piiColumnCount)} PII columns`
            : "Catalog health at a glance — quality, trust, value and exposure."}
        </p>
      </header>

      {overviewQ.isLoading ? (
        <DashboardSkeleton />
      ) : overviewQ.isError || !o ? (
        <DashboardError
          message={overviewQ.error instanceof Error ? overviewQ.error.message : "Something went wrong."}
          onRetry={() => void overviewQ.refetch()}
        />
      ) : o.totalDatasets === 0 ? (
        <DashboardEmpty />
      ) : (
        <motion.div
          className="flex flex-col gap-4"
          variants={staggerContainer}
          initial={reduce ? false : "hidden"}
          animate="show"
        >
          {/* KPI tiles */}
          <motion.div variants={staggerContainer} className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <KpiTile label="Datasets" icon={Database} value={formatCompact(o.totalDatasets)}>
              <CompositionStrip segments={readySplit} />
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {o.ready} ready · {o.processing} processing · {o.failed} failed
              </span>
            </KpiTile>

            <KpiTile label="Avg Quality" icon={ShieldCheck} value={o.ready ? String(o.avgQuality) : "—"} suffix={o.ready ? "/100" : undefined}>
              {o.ready ? <ScoreMeter score={o.avgQuality} /> : <span className="text-[11px] text-muted-foreground">no scored datasets</span>}
              {o.ready > 0 && <span className="text-[11px] font-medium text-muted-foreground">{scoreTier(o.avgQuality).word}</span>}
            </KpiTile>

            <KpiTile label="Avg Trust" icon={ShieldCheck} value={o.ready ? String(o.avgTrust) : "—"} suffix={o.ready ? "/100" : undefined}>
              {o.ready ? <ScoreMeter score={o.avgTrust} /> : <span className="text-[11px] text-muted-foreground">no scored datasets</span>}
              {o.ready > 0 && <span className="text-[11px] font-medium text-muted-foreground">{scoreTier(o.avgTrust).word}</span>}
            </KpiTile>

            <KpiTile label="PII columns" icon={ShieldAlert} value={formatCompact(o.piiColumnCount)}>
              <CompositionStrip
                segments={(["HIGH", "MEDIUM", "LOW"] as Sensitivity[]).map((s) => ({
                  key: s,
                  value: o.sensitivityDistribution[s],
                  color: SENS_COLOR[s],
                }))}
              />
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {o.sensitivityDistribution.HIGH} high · {o.sensitivityDistribution.MEDIUM} med · {o.sensitivityDistribution.LOW} low
              </span>
            </KpiTile>

            <KpiTile
              label="Needs attention"
              icon={TriangleAlert}
              value={formatCompact(o.needsAttention.length)}
              tone={o.needsAttention.length > 0 ? "critical" : undefined}
            >
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {o.failed} failed · {o.recommendationDistribution.RETIRE} to retire
              </span>
            </KpiTile>
          </motion.div>

          {/* Distributions */}
          <motion.div variants={staggerContainer} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RecommendationDonut distribution={o.recommendationDistribution} reduce={reduce} />
            <SensitivityExposure
              distribution={o.sensitivityDistribution}
              piiColumnCount={o.piiColumnCount}
              totalColumns={o.totalColumns}
            />
          </motion.div>

          {/* Quality vs value + recent uploads */}
          <motion.div variants={staggerContainer} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <QualityValueMultiples datasets={datasetsQ.data?.data ?? []} />
            <RecentUploads items={o.recentUploads} />
          </motion.div>

          {/* Needs attention table */}
          <NeedsAttention items={o.needsAttention} />
        </motion.div>
      )}
    </div>
  );
}
