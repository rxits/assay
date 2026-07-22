// Status pills — 05 §3.2–3.4 / §4.4. Pale status-hue tint + a full-strength
// status icon + the level word in ink tokens. Colour is NEVER the sole channel:
// the word is the accessible name, the icon is decorative (aria-hidden, 05 §8).
// One construction, reused for Sensitivity, ValueRecommendation, and Severity.
import {
  Archive,
  CheckCircle2,
  Circle,
  Info,
  OctagonAlert,
  Pencil,
  Shield,
  ShieldAlert,
  ShieldHalf,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Sensitivity, Severity, ValueRecommendation } from "@assay/shared";
import { cn } from "@/lib/utils";

type Tone = "muted" | "good" | "warning" | "critical";
type Size = "sm" | "md";

const TONE_VAR: Record<Tone, string> = {
  muted: "--status-muted",
  good: "--status-good",
  warning: "--status-warning",
  critical: "--status-critical",
};

interface StatusPillProps {
  tone: Tone;
  icon: LucideIcon;
  label: string;
  size?: Size;
  /** Manual override marker (05 §4.4) — hairline ring + a pencil glyph. */
  edited?: boolean;
  title?: string;
}

export function StatusPill({ tone, icon: Icon, label, size = "md", edited, title }: StatusPillProps) {
  const v = TONE_VAR[tone];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium text-foreground",
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-[13px]",
        edited && "ring-1 ring-border",
      )}
      style={{
        background: `color-mix(in srgb, var(${v}) 12%, hsl(var(--card)))`,
        borderColor: `color-mix(in srgb, var(${v}) 24%, transparent)`,
      }}
    >
      <Icon
        aria-hidden="true"
        className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"}
        style={{ color: `var(${v})` }}
        strokeWidth={2.25}
      />
      <span>{label}</span>
      {edited && <Pencil aria-hidden="true" className="ml-0.5 h-2.5 w-2.5 text-muted-foreground" />}
    </span>
  );
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

// ---- Sensitivity (05 §3.2) ----------------------------------------------

const SENSITIVITY: Record<Sensitivity, { tone: Tone; icon: LucideIcon }> = {
  NONE: { tone: "muted", icon: Circle },
  LOW: { tone: "good", icon: Shield },
  MEDIUM: { tone: "warning", icon: ShieldHalf },
  HIGH: { tone: "critical", icon: ShieldAlert },
};

export function SensitivityBadge({
  level,
  size,
  overridden,
}: {
  level: Sensitivity | null;
  size?: Size;
  overridden?: boolean;
}) {
  if (level == null) return <Dash />;
  const s = SENSITIVITY[level];
  return <StatusPill tone={s.tone} icon={s.icon} label={level} size={size} edited={overridden} />;
}

// ---- Value recommendation (05 §3.3) -------------------------------------

const RECOMMENDATION: Record<ValueRecommendation, { tone: Tone; icon: LucideIcon }> = {
  KEEP: { tone: "good", icon: CheckCircle2 },
  OPTIMIZE: { tone: "warning", icon: SlidersHorizontal },
  ARCHIVE: { tone: "muted", icon: Archive },
  RETIRE: { tone: "critical", icon: Trash2 },
};

export function RecommendationBadge({
  value,
  size,
  accesses90d,
}: {
  value: ValueRecommendation | null;
  size?: Size;
  /** Trailing-90-day access count, where the caller has it (catalog/detail rows). */
  accesses90d?: number;
}) {
  if (value == null) return <Dash />;
  // Value is derived purely from access events, so a dataset nobody has opened scores
  // RETIRE by arithmetic rather than by evidence — a fresh upload is not a dead one.
  if (accesses90d === 0) {
    return (
      <StatusPill
        tone="muted"
        icon={Info}
        label="NO USAGE DATA"
        size={size}
        title="No access events in the last 90 days — not enough usage to recommend on yet."
      />
    );
  }
  const r = RECOMMENDATION[value];
  return <StatusPill tone={r.tone} icon={r.icon} label={value} size={size} />;
}

// ---- Quality-check severity (05 §3.4) -----------------------------------

const SEVERITY: Record<Severity, { tone: Tone; icon: LucideIcon }> = {
  INFO: { tone: "muted", icon: Info },
  WARNING: { tone: "warning", icon: TriangleAlert },
  ERROR: { tone: "critical", icon: OctagonAlert },
};

export function SeverityBadge({ severity, size }: { severity: Severity; size?: Size }) {
  const s = SEVERITY[severity];
  return <StatusPill tone={s.tone} icon={s.icon} label={severity} size={size} />;
}
