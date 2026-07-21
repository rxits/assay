// Column-detail panel — 05 §4.6. The expanded body of a columns-table row: full
// classification (badge + category + source + confidence), a manual override control
// (PATCH …/classification → optimistic "Trust recomputed" toast), profile stats,
// the missing-value meter + a numeric histogram (or a top-values list for strings),
// and this column's quality checks. Reuses the shared badges + charts.
import { useState } from "react";
import type {
  ColumnDTO,
  PiiCategory,
  QualityCheckDTO,
  Sensitivity,
} from "@assay/shared";
import { MissingValueBar } from "@/components/charts/MissingValueBar";
import { NumericHistogram } from "@/components/charts/NumericHistogram";
import { SensitivityBadge, SeverityBadge } from "@/components/dataset/SensitivityBadge";
import { useOverrideClassification } from "@/lib/api";
import { formatCount, formatPct } from "@/lib/format";
import { toast } from "@/lib/toast";

const PII_CATEGORIES: PiiCategory[] = [
  "NONE", "EMAIL", "PHONE", "ID_NUMBER", "CREDIT_CARD", "DATE_OF_BIRTH",
  "NAME", "ADDRESS", "IP_ADDRESS", "POSTAL_CODE", "OTHER",
];
const SENSITIVITIES: Sensitivity[] = ["NONE", "LOW", "MEDIUM", "HIGH"];
const NUMERIC = new Set(["INTEGER", "FLOAT"]);

const SELECT_CLASS =
  "rounded-lg border border-[color:var(--glass-border)] bg-background/50 px-2 py-1.5 text-[13px] text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";

export function ColumnPanel({
  datasetId,
  column,
  checks,
}: {
  datasetId: string;
  column: ColumnDTO;
  /** Quality checks scoped to this column (05 §4.6). */
  checks: QualityCheckDTO[];
}) {
  const tag = column.classificationTag;
  const override = useOverrideClassification();
  const [category, setCategory] = useState<PiiCategory>(tag?.category ?? "NONE");
  // "" → omit sensitivity, so the API applies the category's default (04 §2.5).
  const [sensitivity, setSensitivity] = useState<Sensitivity | "">("");

  const missingCheck = checks.find((c) => c.checkType === "MISSING_VALUES");
  const isNumeric = NUMERIC.has(column.dataType);

  function apply() {
    // Optimistic toast (05 §4.6): confirm intent immediately; the hook invalidates
    // the dataset so the recomputed Trust gauge refetches. Roll back to an error
    // toast if the PATCH is rejected.
    toast("Reclassified — Trust recomputed");
    override.mutate(
      { datasetId, columnId: column.id, category, sensitivity: sensitivity || undefined },
      {
        onError: (e) => toast(e instanceof Error ? e.message : "Override failed", "error"),
      },
    );
  }

  return (
    <div className="border-t border-[color:var(--glass-border)] bg-background/30 px-4 py-4">
      {/* Header — identity + current classification. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-mono text-[14px] font-medium text-foreground">{column.name}</span>
        <TypePill dataType={column.dataType} />
        <span className="text-[12px] text-muted-foreground">position {column.position}</span>
        <span className="mx-1 h-3 w-px bg-[color:var(--glass-border)]" aria-hidden="true" />
        <SensitivityBadge level={tag?.sensitivity ?? null} size="sm" overridden={tag?.overridden} />
        {tag && (
          <span className="text-[12px] text-muted-foreground">
            {tag.category} · {tag.source}
            {tag.confidence != null && ` · conf ${formatPct(tag.confidence)}`}
          </span>
        )}
      </div>

      {/* Manual override — 05 §4.6 / 04 §2.5. */}
      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-[color:var(--glass-border)] bg-background/40 p-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
          Category
          <select className={SELECT_CLASS} value={category} onChange={(e) => setCategory(e.target.value as PiiCategory)}>
            {PII_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
          Sensitivity
          <select className={SELECT_CLASS} value={sensitivity} onChange={(e) => setSensitivity(e.target.value as Sensitivity | "")}>
            <option value="">Category default</option>
            {SENSITIVITIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={apply}
          disabled={override.isPending}
          className="rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground outline-none transition-[opacity,transform] duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
        >
          {override.isPending ? "Saving…" : "Reclassify"}
        </button>
      </div>

      {/* Profile stats. */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Stat label="Completeness" value={formatPct(column.completeness)} />
        <Stat label="Validity" value={formatPct(column.validity)} />
        <Stat label="Missing" value={formatPct(column.missingPct)} />
        <Stat label="Distinct" value={formatCount(column.distinctCount)} />
      </dl>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <Caption>Missing values</Caption>
          <div className="mt-1.5">
            <MissingValueBar pct={column.missingPct} severity={missingCheck?.severity} />
          </div>
        </div>
        <div>
          <Caption>{isNumeric ? "Distribution" : "Sample values"}</Caption>
          <div className="mt-1.5">
            {isNumeric ? (
              <NumericHistogram values={column.sampleValues} />
            ) : (
              <SampleValues values={column.sampleValues} />
            )}
          </div>
        </div>
      </div>

      {/* Column-scoped quality checks. */}
      <div className="mt-4">
        <Caption>Quality checks</Caption>
        {checks.length === 0 ? (
          <p className="mt-1.5 text-[13px] text-muted-foreground">No quality checks for this column.</p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-[13px]">
                <SeverityBadge severity={c.severity} size="sm" />
                <span className="text-muted-foreground">{c.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TypePill({ dataType }: { dataType: string }) {
  return (
    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
      {dataType}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-[15px] text-foreground">{value}</dd>
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{children}</span>
  );
}

function SampleValues({ values }: { values: unknown[] }) {
  if (values.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No sample values.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {values.slice(0, 8).map((v, i) => (
        <li
          key={i}
          className="max-w-[16rem] truncate rounded-md border border-[color:var(--glass-border)] bg-background/40 px-1.5 py-0.5 font-mono text-[12px] text-foreground"
          title={String(v)}
        >
          {String(v)}
        </li>
      ))}
    </ul>
  );
}
