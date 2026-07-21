// Catalog data-table — 05 §4.1 / §6a, repainted onto the R1 glass system (R2.2).
// Semantic <table> inside one glass surface; score columns render an inline
// mini-gauge + tabular numeral; Name/Rows/Quality/Trust/Value/Uploaded headers are
// sort buttons driving ?sort with aria-sort. A "Views" column carries the brief's
// usage/view count (accessCount) as a tabular numeral beside a magnitude micro-bar
// — sequential single hue, normalised to the page's busiest dataset (dataviz: the
// bar is decorative reinforcement, the numeral is the value). Rows link to the
// detail page, stagger in on mount, and reveal a spring accent rail on hover.
// PROCESSING → indeterminate score cells; FAILED → dashed scores + errorMessage.
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, FileText, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import type { DatasetSummary } from "@assay/shared";
import { ScoreGauge } from "@/components/dataset/ScoreGauge";
import { RecommendationBadge, SensitivityBadge } from "@/components/dataset/SensitivityBadge";
import { formatCompact, formatCount, relativeTime } from "@/lib/format";
import { fadeUpItem, staggerContainer, useReduceMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Header key → API sort key (04 §1.6). Only these six are sortable.
const SORT_KEYS = {
  name: "name",
  rowCount: "rowCount",
  qualityScore: "qualityScore",
  trustScore: "trustScore",
  valueScore: "valueScore",
  uploadedAt: "uploadedAt",
} as const;
type SortKey = (typeof SORT_KEYS)[keyof typeof SORT_KEYS];

// name sorts A→Z by default; magnitudes/dates sort high→low (desc) by default.
const DEFAULT_DESC: Record<SortKey, boolean> = {
  name: false,
  rowCount: true,
  qualityScore: true,
  trustScore: true,
  valueScore: true,
  uploadedAt: true,
};

function parseSort(sort: string): { key: string; desc: boolean } {
  const desc = sort.startsWith("-");
  return { key: desc ? sort.slice(1) : sort, desc };
}

interface CatalogTableProps {
  datasets: DatasetSummary[];
  sort: string;
  onSortChange: (sort: string) => void;
  /** Hold the frame at reduced opacity during a filter refetch (05 §5.4). */
  dimmed?: boolean;
}

export function CatalogTable({ datasets, sort, onSortChange, dimmed }: CatalogTableProps) {
  const navigate = useNavigate();
  const reduce = useReduceMotion();
  const current = parseSort(sort);
  // Normalise the usage micro-bars to the busiest dataset on this page.
  const maxViews = Math.max(...datasets.map((d) => d.accessCount), 1);

  function toggle(key: SortKey) {
    if (current.key === key) {
      onSortChange(`${current.desc ? "" : "-"}${key}`);
    } else {
      onSortChange(`${DEFAULT_DESC[key] ? "-" : ""}${key}`);
    }
  }

  function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
    if (current.key !== key) return "none";
    return current.desc ? "descending" : "ascending";
  }

  return (
    <div
      className={cn(
        "glass overflow-hidden rounded-xl border border-[color:var(--glass-border)] transition-opacity duration-200",
        dimmed && "opacity-50",
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-[color:var(--glass-border)] bg-background/25">
              <SortHeader label="Name" sortKey="name" onToggle={toggle} ariaSort={ariaSort} align="left" active={current.key === "name"} desc={current.desc} />
              <SortHeader label="Rows" sortKey="rowCount" onToggle={toggle} ariaSort={ariaSort} align="right" active={current.key === "rowCount"} desc={current.desc} />
              <Th align="right">Cols</Th>
              <SortHeader label="Quality" sortKey="qualityScore" onToggle={toggle} ariaSort={ariaSort} align="left" active={current.key === "qualityScore"} desc={current.desc} />
              <SortHeader label="Trust" sortKey="trustScore" onToggle={toggle} ariaSort={ariaSort} align="left" active={current.key === "trustScore"} desc={current.desc} />
              <SortHeader label="Value" sortKey="valueScore" onToggle={toggle} ariaSort={ariaSort} align="left" active={current.key === "valueScore"} desc={current.desc} />
              <Th align="left">Recommendation</Th>
              <Th align="left">Sensitivity</Th>
              <Th align="right">Views</Th>
              <Th align="left">Last used</Th>
              <SortHeader label="Uploaded" sortKey="uploadedAt" onToggle={toggle} ariaSort={ariaSort} align="right" active={current.key === "uploadedAt"} desc={current.desc} />
            </tr>
          </thead>
          <motion.tbody variants={staggerContainer} initial={reduce ? false : "hidden"} animate="show">
            {datasets.map((d) => (
              <Row key={d.id} dataset={d} maxViews={maxViews} onOpen={() => navigate(`/datasets/${d.id}`)} />
            ))}
          </motion.tbody>
        </table>
      </div>
    </div>
  );
}

const HEADER_CLASS =
  "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground";

function Th({ children, align }: { children: ReactNode; align: "left" | "right" }) {
  return (
    <th scope="col" className={cn(HEADER_CLASS, align === "right" ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}

function SortHeader({
  label,
  sortKey,
  onToggle,
  ariaSort,
  align,
  active,
  desc,
}: {
  label: string;
  sortKey: SortKey;
  onToggle: (k: SortKey) => void;
  ariaSort: (k: SortKey) => "ascending" | "descending" | "none";
  align: "left" | "right";
  active: boolean;
  desc: boolean;
}) {
  const Caret = !active ? ArrowUpDown : desc ? ArrowDown : ArrowUp;
  return (
    <th scope="col" aria-sort={ariaSort(sortKey)} className={cn(HEADER_CLASS, "p-0")}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={cn(
          // The caret springs into its new direction rather than swapping hard.
          "group flex w-full items-center gap-1.5 px-3 py-2.5 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" ? "justify-end" : "justify-start",
          active && "text-foreground",
        )}
      >
        <span>{label}</span>
        <Caret
          aria-hidden="true"
          className={cn(
            "h-3 w-3 transition-[opacity,transform] duration-200 [transition-timing-function:var(--ease-spring)]",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-50",
          )}
        />
      </button>
    </th>
  );
}

function Row({
  dataset: d,
  maxViews,
  onOpen,
}: {
  dataset: DatasetSummary;
  maxViews: number;
  onOpen: () => void;
}) {
  const FileIcon = d.fileType === "XLSX" ? FileSpreadsheet : FileText;
  const failed = d.status === "FAILED";
  const processing = d.status === "PROCESSING";

  return (
    <motion.tr
      variants={fadeUpItem}
      onClick={onOpen}
      className="group cursor-pointer border-b border-[color:var(--glass-border)] transition-colors last:border-0 hover:bg-accent/45"
    >
      <td className="relative px-3 py-2.5">
        {/* Spring accent rail — transform-only, so it stays cheap and interruptible. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-[2px] origin-center scale-y-0 rounded-full bg-primary transition-transform duration-200 [transition-timing-function:var(--ease-spring)] group-hover:scale-y-100"
        />
        <span className="flex items-center gap-2">
          <FileIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
          <a
            href={`/datasets/${d.id}`}
            onClick={(e) => {
              e.preventDefault();
              onOpen();
            }}
            className="truncate font-medium text-foreground outline-none transition-transform duration-200 [transition-timing-function:var(--ease-spring)] group-hover:translate-x-0.5 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {d.name}
          </a>
          {failed && (
            <span
              title={d.errorMessage ?? "Processing failed"}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[color:var(--status-critical)]"
            >
              <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />
              Failed
            </span>
          )}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
        {failed || processing ? "—" : formatCount(d.rowCount)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
        {failed || processing ? "—" : formatCount(d.columnCount)}
      </td>
      <ScoreCell score={d.qualityScore} label="Quality" status={d.status} />
      <ScoreCell score={d.trustScore} label="Trust" status={d.status} />
      <ScoreCell score={d.valueScore} label="Value" status={d.status} />
      <td className="px-3 py-2.5">
        {failed || processing ? <span className="text-muted-foreground">—</span> : <RecommendationBadge value={d.valueRecommendation} size="sm" />}
      </td>
      <td className="px-3 py-2.5">
        {failed || processing ? <span className="text-muted-foreground">—</span> : <SensitivityBadge level={d.highestSensitivity} size="sm" />}
      </td>
      <ViewsCell count={d.accessCount} recent={d.accessCount90d} max={maxViews} />
      <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
        <time dateTime={d.lastAccessedAt ?? undefined} title={d.lastAccessedAt ?? "never accessed"}>
          {relativeTime(d.lastAccessedAt)}
        </time>
      </td>
      <td className="px-3 py-2.5 text-right text-[13px] text-muted-foreground">
        <time dateTime={d.uploadedAt} title={d.uploadedAt}>
          {relativeTime(d.uploadedAt)}
        </time>
      </td>
    </motion.tr>
  );
}

/**
 * Usage/view count. The numeral is the value; the bar behind it is a sequential
 * magnitude cue (single hue, page-relative) so the busiest datasets pop while
 * scanning. Deliberately not role="meter" — one screen-reader value per cell.
 */
function ViewsCell({ count, recent, max }: { count: number; recent: number; max: number }) {
  return (
    <td className="px-3 py-2.5">
      <span
        className="flex items-center justify-end gap-2"
        title={`${formatCount(count)} total ${count === 1 ? "view" : "views"} · ${formatCount(recent)} in the last 90 days`}
      >
        <span
          aria-hidden="true"
          className="hidden h-1.5 w-10 shrink-0 overflow-hidden rounded-full lg:block"
          style={{ background: "var(--gauge-track)" }}
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${(count / max) * 100}%`, background: "var(--score-band-2)" }}
          />
        </span>
        <span className={cn("w-9 text-right text-[13px] tabular-nums", count > 0 ? "text-foreground" : "text-muted-foreground")}>
          {count > 0 ? formatCompact(count) : "—"}
        </span>
      </span>
    </td>
  );
}

function ScoreCell({
  score,
  label,
  status,
}: {
  score: number | null;
  label: string;
  status: DatasetSummary["status"];
}) {
  return (
    <td className="px-3 py-2.5">
      <ScoreGauge score={score} label={label} variant="inline" status={status} />
    </td>
  );
}
