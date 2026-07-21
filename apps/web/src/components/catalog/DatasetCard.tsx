// Responsive <768px fallback — 05 §4.2. One card = name + type, a 3-up inline
// mini-gauge strip (Q/T/V), a recommendation chip, the top sensitivity badge,
// row/col meta and last-use. Mini-gauges are inline, never nested cards (no
// card-in-card — 05 §1/§4.2).
import { FileSpreadsheet, FileText, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import type { DatasetSummary } from "@assay/shared";
import { ScoreGauge } from "@/components/dataset/ScoreGauge";
import { RecommendationBadge, SensitivityBadge } from "@/components/dataset/SensitivityBadge";
import { formatCount, relativeTime } from "@/lib/format";

export function DatasetCard({ dataset: d }: { dataset: DatasetSummary }) {
  const FileIcon = d.fileType === "XLSX" ? FileSpreadsheet : FileText;
  const failed = d.status === "FAILED";
  const scored = d.status === "READY";

  return (
    <Link
      to={`/datasets/${d.id}`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2">
        <FileIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">{d.name}</span>
        {failed && (
          <span
            title={d.errorMessage ?? "Processing failed"}
            className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-[color:var(--status-critical)]"
          >
            <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />
            Failed
          </span>
        )}
      </div>

      {scored ? (
        <>
          <div className="flex items-center justify-around">
            <ScoreGauge score={d.qualityScore} label="Quality" variant="inline" status={d.status} />
            <ScoreGauge score={d.trustScore} label="Trust" variant="inline" status={d.status} />
            <ScoreGauge score={d.valueScore} label="Value" variant="inline" status={d.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RecommendationBadge value={d.valueRecommendation} size="sm" />
            <SensitivityBadge level={d.highestSensitivity} size="sm" />
          </div>
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {failed ? (d.errorMessage ?? "Processing failed.") : "Profiling…"}
        </p>
      )}

      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
        <span className="tabular-nums">
          {failed ? "—" : `${formatCount(d.rowCount)} rows · ${formatCount(d.columnCount)} cols`}
        </span>
        <time dateTime={d.uploadedAt} title={d.uploadedAt}>
          {relativeTime(d.uploadedAt)}
        </time>
      </div>
    </Link>
  );
}
