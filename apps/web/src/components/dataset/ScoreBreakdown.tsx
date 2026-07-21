// "Explain this score" breakdown popover — 05 §4.5, the transparency centrepiece.
// A Radix Popover anchored to a ScoreGauge, rendered as a focus-trapped
// role="dialog" (modal) that Esc-closes and returns focus to the gauge. It turns
// one scoreBreakdown entry ({score, inputs, weights}) into weighted contribution
// rows: weight × input = contribution (points), each bar in the sequential blue
// ramp (05 §3.1), numbers in ink tokens + tabular-nums, weights-from-config footnote.
import { useId, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import type {
  DatasetStatus,
  QualityBreakdown,
  TrustBreakdown,
  ValueBreakdown,
} from "@assay/shared";
import { ScoreGauge, scoreBand, scoreTier } from "@/components/dataset/ScoreGauge";

type Entry = QualityBreakdown | TrustBreakdown | ValueBreakdown;

// input-key → display label (keys are exactly the §9 sub-score names, 04 §2.4).
const LABELS: Record<string, string> = {
  completeness: "Completeness",
  validity: "Validity",
  uniqueness: "Uniqueness",
  quality: "Quality",
  consistency: "Consistency",
  classificationCoverage: "Classification coverage",
  frequency: "Frequency",
  recency: "Recency",
  trend: "Trend",
};

const TONE_VAR: Record<"good" | "warning" | "critical", string> = {
  good: "--status-good",
  warning: "--status-warning",
  critical: "--status-critical",
};

interface Row {
  key: string;
  label: string;
  input: number;
  weight: number;
  contribution: number;
}

// Every sub-score input is a 0–1 ratio (04 §2.4), so contribution = 100·weight·input
// (points) uniformly, and the rows sum to ≈ score (06 §4–§6).
function toRows(entry: Entry): Row[] {
  const inputs = entry.inputs as Record<string, number>;
  const weights = entry.weights as Record<string, number>;
  return Object.keys(inputs).map((key) => {
    const input = inputs[key] ?? 0;
    const weight = weights[key] ?? 0;
    return { key, label: LABELS[key] ?? key, input, weight, contribution: 100 * weight * input };
  });
}

function Body({ label, score, entry, headingId }: { label: string; score: number; entry: Entry; headingId: string }) {
  const rows = toRows(entry);
  const max = Math.max(...rows.map((r) => r.contribution), 1);
  const tier = scoreTier(score);
  return (
    <div>
      <div id={headingId} className="flex items-baseline justify-between gap-2 border-b border-border pb-2">
        <span className="text-[15px] font-semibold text-foreground">{label}</span>
        <span className="inline-flex items-center gap-1.5 text-[13px]">
          <span className="tabular-nums text-[18px] font-semibold text-foreground">{score.toFixed(1)}</span>
          <span
            className="ml-1 h-2 w-2 rounded-full"
            style={{ background: `var(${TONE_VAR[tier.tone]})` }}
            aria-hidden="true"
          />
          <span className="text-muted-foreground">{tier.word}</span>
        </span>
      </div>

      <ul className="mt-3 flex flex-col gap-2.5">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="text-foreground">{r.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {r.weight.toFixed(2)} × {r.input.toFixed(2)}
                <span className="ml-2 font-medium text-foreground">= {r.contribution.toFixed(1)}</span>
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: "var(--gauge-track)" }}
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(r.contribution / max) * 100}%`,
                  background: `var(--score-band-${scoreBand(r.input * 100)})`,
                }}
              />
            </div>
            {/* §8: visually-hidden text equivalent of each weight × value. */}
            <span className="sr-only">
              {r.label}: weight {r.weight.toFixed(2)} times {r.input.toFixed(2)} equals{" "}
              {r.contribution.toFixed(1)} points.
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
        Weights from the shared config (00-SPEC §9).
      </p>
    </div>
  );
}

interface ScoreBreakdownProps {
  label: string;
  score: number | null;
  status?: DatasetStatus;
  /** The score's breakdown entry (null when FAILED / not yet scored). */
  entry: Entry | null;
}

export function ScoreBreakdown({ label, score, status, entry }: ScoreBreakdownProps) {
  const [open, setOpen] = useState(false);
  const headingId = useId();

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal>
      {/* Anchor (not Trigger): the gauge stays the reused button; onExplain drives open,
          and Radix's FocusScope restores focus to it (the previously-focused node) on close. */}
      <Popover.Anchor asChild>
        <span className="inline-flex">
          <ScoreGauge
            score={score}
            label={label}
            variant="detail"
            status={status}
            onExplain={() => setOpen(true)}
          />
        </span>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          role="dialog"
          aria-labelledby={headingId}
          side="bottom"
          align="center"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-80 max-w-[320px] rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none"
        >
          {entry && score != null ? (
            <Body label={label} score={score} entry={entry} headingId={headingId} />
          ) : (
            <p id={headingId} className="text-[13px] text-muted-foreground">
              {label} breakdown is unavailable for this dataset.
            </p>
          )}
          <Popover.Arrow className="fill-[hsl(var(--popover))] stroke-border" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
