// Missing-value meter — 05 §4.7a. A single horizontal magnitude bar of one column's
// missingPct: fill length encodes the magnitude (single blue hue), track = gauge
// step-100. A WARNING/ERROR MISSING_VALUES check adds a status severity pip; valence
// rides that pip, never the fill (05 §3). The % value labels the tip.
import type { Severity } from "@assay/shared";
import { formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export function MissingValueBar({
  pct,
  severity,
  className,
}: {
  pct: number;
  /** Severity of this column's MISSING_VALUES check, if any (drives the pip). */
  severity?: Severity;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(1, pct));
  const flagged = severity === "WARNING" || severity === "ERROR";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="meter"
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Missing ${formatPct(clamped)}`}
        className="relative h-1.5 flex-1 overflow-hidden rounded-full"
        style={{ background: "var(--gauge-track)" }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${clamped * 100}%`, background: "var(--score-band-2)" }}
        />
      </div>
      <span className="w-10 shrink-0 text-right tabular-nums text-[12px] text-muted-foreground">
        {formatPct(clamped)}
      </span>
      {flagged && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: `var(--status-${severity === "ERROR" ? "critical" : "warning"})` }}
        />
      )}
    </div>
  );
}
