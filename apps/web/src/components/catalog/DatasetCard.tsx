// Responsive <768px fallback — 05 §4.2, on the R1 glass system (R2.2). One card =
// name + type, a 3-up inline mini-gauge strip (Q/T/V), a recommendation chip, the
// top sensitivity badge, row/col meta, the usage/view count and last-use. Mini-gauges
// are inline, never nested cards (no card-in-card — 05 §1/§4.2).
import { Eye, FileSpreadsheet, FileText, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";
import type { DatasetSummary } from "@assay/shared";
import { ScoreGauge } from "@/components/dataset/ScoreGauge";
import { RecommendationBadge, SensitivityBadge } from "@/components/dataset/SensitivityBadge";
import { formatCompact, formatCount, relativeTime } from "@/lib/format";
import { fadeUpItem } from "@/lib/motion";

// The three scores in display order, paired with the initial that identifies each gauge.
const SCORES: ReadonlyArray<readonly [string, (d: DatasetSummary) => number | null]> = [
  ["Quality", (d) => d.qualityScore],
  ["Trust", (d) => d.trustScore],
  ["Value", (d) => d.valueScore],
];

export function DatasetCard({ dataset: d }: { dataset: DatasetSummary }) {
  const FileIcon = d.fileType === "XLSX" ? FileSpreadsheet : FileText;
  const failed = d.status === "FAILED";
  const scored = d.status === "READY";

  return (
    <motion.div variants={fadeUpItem}>
      <Link
        to={`/datasets/${d.id}`}
        className="glass flex flex-col gap-3 rounded-xl border border-[color:var(--glass-border)] p-4 outline-none transition-[background-color,transform] duration-200 [transition-timing-function:var(--ease-spring)] hover:bg-accent/45 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
      >
        <div className="flex items-center gap-2">
          <FileIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">{d.name}</span>
          {failed && (
            <span
              title={d.errorMessage ?? "Processing failed"}
              className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-[color:var(--status-critical-fg)]"
            >
              <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />
              Failed
            </span>
          )}
        </div>

        {scored ? (
          <>
            {/* Q/T/V caption per gauge (the dashboard's MiniBar pattern): the inline variant
                carries its identity in aria-label only, so without it the strip reads "87 93 63". */}
            <div className="flex items-center justify-around">
              {SCORES.map(([label, score]) => (
                <span key={label} className="inline-flex items-center gap-1">
                  <span aria-hidden="true" className="text-[10px] font-semibold uppercase text-muted-foreground">
                    {label[0]}
                  </span>
                  <ScoreGauge score={score(d)} label={label} variant="inline" status={d.status} />
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RecommendationBadge value={d.valueRecommendation} size="sm" accesses90d={d.accessCount90d} />
              <SensitivityBadge level={d.highestSensitivity} size="sm" />
            </div>
          </>
        ) : (
          <p className="text-pretty text-[13px] text-muted-foreground">
            {failed ? (d.errorMessage ?? "Processing failed.") : "Profiling…"}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
          <span className="tabular-nums">
            {failed ? "—" : `${formatCount(d.rowCount)} rows · ${formatCount(d.columnCount)} cols`}
          </span>
          <span className="flex shrink-0 items-center gap-3">
            {/* Usage/view count — icon + numeral, so it reads without a column header. */}
            <span
              className="inline-flex items-center gap-1 tabular-nums"
              title={`${formatCount(d.accessCount)} total views · ${formatCount(d.accessCount90d)} in the last 90 days`}
            >
              <Eye aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="sr-only">Views: </span>
              {formatCompact(d.accessCount)}
            </span>
            <time dateTime={d.uploadedAt} title={d.uploadedAt}>
              {relativeTime(d.uploadedAt)}
            </time>
          </span>
        </div>
      </Link>
    </motion.div>
  );
}
