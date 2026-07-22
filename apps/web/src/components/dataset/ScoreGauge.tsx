// Circular score gauge — 05 §4.3. A 3/4-open (270°) ring whose fill is the
// sequential blue ramp by score band (05 §3.1) and whose sweep angle encodes the
// same magnitude, so the value survives greyscale/CVD (double-encoded, 05 §8).
//
// Two variants:
//  - "detail"  132px, a <button aria-haspopup="dialog"> that opens the "explain
//              this score" breakdown (the popover itself is Phase 3C — here we
//              just call `onExplain`). Numeral + label + valence tier chip + a
//              "Why?" caption, so the breakdown is visible and not just announced.
//  - "inline"  40px, role="meter" once there is a value to report, for table cells /
//              card strips (not a button; the row/card is the click target).
import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import type { DatasetStatus } from "@assay/shared";
import { cn } from "@/lib/utils";

type Variant = "detail" | "inline";

interface ScoreGaugeProps {
  score: number | null;
  /** Uppercase identity word — Quality/Trust/Value (05 §3.1: identity is the label, never hue). */
  label: string;
  variant?: Variant;
  status?: DatasetStatus;
  /** Detail variant only: opens the breakdown popover (Phase 3C). */
  onExplain?: () => void;
  className?: string;
}

const SWEEP = 0.75; // 270° of the full circle is visible (a 3/4 gauge).

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** 0–24 → 0 … 90–100 → 4 (05 §3.1 bands). Exported: the breakdown bars reuse the ramp. */
export function scoreBand(score: number): 0 | 1 | 2 | 3 | 4 {
  if (score < 25) return 0;
  if (score < 50) return 1;
  if (score < 75) return 2;
  if (score < 90) return 3;
  return 4;
}

/**
 * What each score actually means, in one line — the Trust-vs-Value distinction the
 * catalog is judged on. Written once here (the score vocabulary already lives in this
 * module) and read by the settings weight hints, the catalog headers and the KPI tiles,
 * so those three never drift apart.
 */
export const SCORE_COPY: Record<"quality" | "trust" | "value", string> = {
  quality: "Quality measures the data itself: how complete, how valid and how distinct its values are.",
  trust: "Trust folds Quality back in alongside type consistency and how much of the dataset is classified.",
  value: "Value is derived from access events: how often, how recently, and which way the trend is going.",
};

type Tone = "good" | "warning" | "critical";
/** Valence ("is this good?") — rides the tier chip, NOT the ring (05 §3.1). Shared with the breakdown header. */
export function scoreTier(score: number): { word: string; tone: Tone } {
  if (score >= 80) return { word: "Good", tone: "good" };
  if (score >= 60) return { word: "Fair", tone: "warning" };
  return { word: "Poor", tone: "critical" };
}

interface RingProps {
  score: number | null;
  size: number;
  stroke: number;
  processing: boolean;
  animate: boolean;
}

/** The SVG ring itself (decorative — aria lives on the wrapping meter/button). */
function Ring({ score, size, stroke, processing, animate }: RingProps) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const c = 2 * Math.PI * r;
  const arc = SWEEP * c;
  const pct = score == null ? 0 : clamp(score) / 100;

  // Grow the fill from empty → target via a dashoffset transition on mount.
  const [shown, setShown] = useState(animate ? 0 : pct);
  useEffect(() => {
    if (animate) {
      const id = requestAnimationFrame(() => setShown(pct));
      return () => cancelAnimationFrame(id);
    }
    setShown(pct);
    return undefined;
  }, [pct, animate]);

  if (processing) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke="hsl(var(--muted))"
          strokeLinecap="round"
          strokeDasharray={`${arc * 0.25} ${c}`}
          transform={`rotate(135 ${cx} ${cx})`}
          className="origin-center animate-spin [animation-duration:1.1s]"
        />
      </svg>
    );
  }

  const fill = score == null ? "var(--gauge-track)" : `var(--score-band-${scoreBand(score)})`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {/* track */}
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        strokeWidth={stroke}
        stroke="var(--gauge-track)"
        strokeLinecap="round"
        strokeDasharray={`${arc} ${c}`}
        transform={`rotate(135 ${cx} ${cx})`}
      />
      {/* fill */}
      {score != null && (
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke={fill}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${c}`}
          strokeDashoffset={arc * (1 - shown)}
          transform={`rotate(135 ${cx} ${cx})`}
          style={{ transition: "stroke-dashoffset var(--dur-slow) var(--ease-standard)" }}
        />
      )}
    </svg>
  );
}

const TONE_VAR: Record<Tone, string> = {
  good: "--status-good",
  warning: "--status-warning",
  critical: "--status-critical",
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function ScoreGauge({
  score,
  label,
  variant = "detail",
  status,
  onExplain,
  className,
}: ScoreGaugeProps) {
  const processing = status === "PROCESSING";
  const failed = status === "FAILED";
  const animate = !prefersReducedMotion() && !processing && score != null;
  const numeral = score == null || failed ? "—" : String(Math.round(score));
  const tier = score != null && !failed ? scoreTier(score) : null;
  const ariaLabel =
    score == null || failed
      ? `${label} score unavailable`
      : `${label} score ${Math.round(score)} of 100${tier ? `, ${tier.word}` : ""}`;

  if (variant === "inline") {
    const size = 40;
    // A meter with no value is a broken meter (axe aria-required-attr), and FAILED /
    // PROCESSING rows have none — those read as a plain labelled span instead.
    const meter =
      score == null || failed
        ? { "aria-label": ariaLabel }
        : { role: "meter", "aria-valuenow": score, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": ariaLabel };
    return (
      <span {...meter} className={cn("inline-flex items-center gap-1.5", className)}>
        {processing ? (
          <span
            className="assay-indeterminate h-1.5 w-9 rounded-full bg-muted"
            aria-hidden="true"
          />
        ) : (
          <Ring
            score={failed ? null : score}
            size={size}
            stroke={4.5}
            processing={false}
            animate={animate}
          />
        )}
        {!processing && (
          <span
            className={cn(
              "tabular-nums text-[13px] font-medium",
              failed || score == null ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {numeral}
          </span>
        )}
      </span>
    );
  }

  // detail variant
  const size = 132;
  const inner = (
    <>
      <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <Ring score={failed ? null : score} size={size} stroke={14} processing={processing} animate={animate} />
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[32px] font-bold leading-9 text-foreground">{processing ? "" : numeral}</span>
          <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            {label}
          </span>
        </span>
      </span>
      {tier && (
        <>
          <span className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: `var(${TONE_VAR[tier.tone]})` }}
              aria-hidden="true"
            />
            {tier.word}
          </span>
          {/* The breakdown was announced to screen readers and to nobody else. A quiet
              caption tells sighted readers the ring opens. aria-hidden: the button's own
              label already ends in "Explain this score." */}
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors group-hover:text-foreground"
          >
            <Info className="h-3 w-3" />
            Why?
          </span>
        </>
      )}
    </>
  );

  return (
    <button
      type="button"
      onClick={onExplain}
      aria-haspopup="dialog"
      aria-label={`${ariaLabel}. Explain this score.`}
      className={cn(
        "group flex flex-col items-center rounded-lg p-2 outline-none transition-colors",
        "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {inner}
    </button>
  );
}
