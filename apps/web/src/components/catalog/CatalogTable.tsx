// Catalog data-table — 05 §4.1 / §6a. Semantic <table>; score columns render an
// inline mini-gauge + tabular numeral; Name/Rows/Quality/Trust/Value/Uploaded
// headers are sort buttons driving ?sort with aria-sort. Rows link to the detail
// page. PROCESSING → indeterminate score cells; FAILED → dashed scores + the
// errorMessage on hover.
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, FileText, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { DatasetSummary } from "@assay/shared";
import { ScoreGauge } from "@/components/dataset/ScoreGauge";
import { RecommendationBadge, SensitivityBadge } from "@/components/dataset/SensitivityBadge";
import { formatCount, relativeTime } from "@/lib/format";
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
  const current = parseSort(sort);

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
        "overflow-x-auto rounded-md border border-border bg-card shadow-xs transition-opacity",
        dimmed && "opacity-50",
      )}
    >
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-border">
            <SortHeader label="Name" sortKey="name" onToggle={toggle} ariaSort={ariaSort} align="left" active={current.key === "name"} desc={current.desc} />
            <SortHeader label="Rows" sortKey="rowCount" onToggle={toggle} ariaSort={ariaSort} align="right" active={current.key === "rowCount"} desc={current.desc} />
            <Th align="right">Cols</Th>
            <SortHeader label="Quality" sortKey="qualityScore" onToggle={toggle} ariaSort={ariaSort} align="left" active={current.key === "qualityScore"} desc={current.desc} />
            <SortHeader label="Trust" sortKey="trustScore" onToggle={toggle} ariaSort={ariaSort} align="left" active={current.key === "trustScore"} desc={current.desc} />
            <SortHeader label="Value" sortKey="valueScore" onToggle={toggle} ariaSort={ariaSort} align="left" active={current.key === "valueScore"} desc={current.desc} />
            <Th align="left">Recommendation</Th>
            <Th align="left">Sensitivity</Th>
            <Th align="left">Usage</Th>
            <SortHeader label="Uploaded" sortKey="uploadedAt" onToggle={toggle} ariaSort={ariaSort} align="right" active={current.key === "uploadedAt"} desc={current.desc} />
          </tr>
        </thead>
        <tbody>
          {datasets.map((d) => (
            <Row key={d.id} dataset={d} onOpen={() => navigate(`/datasets/${d.id}`)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const HEADER_CLASS =
  "px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground";

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
          "flex w-full items-center gap-1 px-3 py-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" ? "justify-end" : "justify-start",
          active && "text-foreground",
        )}
      >
        <span>{label}</span>
        <Caret aria-hidden="true" className={cn("h-3 w-3", !active && "opacity-40")} />
      </button>
    </th>
  );
}

function Row({ dataset: d, onOpen }: { dataset: DatasetSummary; onOpen: () => void }) {
  const FileIcon = d.fileType === "XLSX" ? FileSpreadsheet : FileText;
  const failed = d.status === "FAILED";
  const processing = d.status === "PROCESSING";

  return (
    <tr
      onClick={onOpen}
      className="group cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-accent"
    >
      <td className="px-3 py-2">
        <span className="flex items-center gap-2">
          <FileIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <a
            href={`/datasets/${d.id}`}
            onClick={(e) => {
              e.preventDefault();
              onOpen();
            }}
            className="truncate font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
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
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {failed || processing ? "—" : formatCount(d.rowCount)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {failed || processing ? "—" : formatCount(d.columnCount)}
      </td>
      <ScoreCell score={d.qualityScore} label="Quality" status={d.status} />
      <ScoreCell score={d.trustScore} label="Trust" status={d.status} />
      <ScoreCell score={d.valueScore} label="Value" status={d.status} />
      <td className="px-3 py-2">
        {failed || processing ? <span className="text-muted-foreground">—</span> : <RecommendationBadge value={d.valueRecommendation} size="sm" />}
      </td>
      <td className="px-3 py-2">
        {failed || processing ? <span className="text-muted-foreground">—</span> : <SensitivityBadge level={d.highestSensitivity} size="sm" />}
      </td>
      <td className="px-3 py-2 text-[13px] text-muted-foreground">
        <time dateTime={d.lastAccessedAt ?? undefined} title={d.lastAccessedAt ?? "never accessed"}>
          {relativeTime(d.lastAccessedAt)}
        </time>
      </td>
      <td className="px-3 py-2 text-right text-[13px] text-muted-foreground">
        <time dateTime={d.uploadedAt} title={d.uploadedAt}>
          {relativeTime(d.uploadedAt)}
        </time>
      </td>
    </tr>
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
    <td className="px-3 py-2">
      <ScoreGauge score={score} label={label} variant="inline" status={status} />
    </td>
  );
}
