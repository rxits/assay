// Numeric histogram — 05 §4.7c. Value frequency across equal-width bins for a
// numeric column. Single blue hue, ≤24px bars with 4px rounded caps, X = bin
// ranges, Y = frequency. The mark is the hit target (05 §5.2). Values come from the
// column's sampleValues (ColumnDTO, ≤10) — thin but honest to the API surface;
// too few numeric samples → the designed empty state (05 §5.4).
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { ChartEmpty } from "@/components/charts/chart-shell";
import { formatCompact } from "@/lib/format";

interface Bin {
  label: string;
  count: number;
}

function toNumbers(values: unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function fmt(n: number): string {
  return Math.abs(n) >= 1000 || Number.isInteger(n) ? formatCompact(Math.round(n)) : n.toFixed(1);
}

function binize(values: number[], binCount = 6): Bin[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ label: fmt(min), count: values.length }];
  const width = (max - min) / binCount;
  const buckets: Bin[] = Array.from({ length: binCount }, (_, i) => ({
    label: `${fmt(min + i * width)}–${fmt(min + (i + 1) * width)}`,
    count: 0,
  }));
  for (const v of values) {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / width));
    const bucket = buckets[idx];
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

function HistTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Bin | undefined;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-[color:var(--glass-border)] bg-popover px-2.5 py-1.5 shadow-[var(--glass-shadow)]">
      <div className="text-[13px] text-foreground">{row.label}</div>
      <div className="tabular-nums text-[12px] text-muted-foreground">
        {row.count} {row.count === 1 ? "value" : "values"}
      </div>
    </div>
  );
}

export function NumericHistogram({ values, height = 140 }: { values: unknown[]; height?: number }) {
  const nums = toNumbers(values);
  if (nums.length < 2) {
    return <ChartEmpty icon={BarChart3} message="Not enough numeric samples to chart" height={height} />;
  }
  const bins = binize(nums);
  return (
    <div role="img" aria-label={`Value distribution across ${bins.length} bins from ${nums.length} samples`}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={bins} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
          <XAxis
            dataKey="label"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "var(--chart-axis)" }}
            interval={0}
          />
          <YAxis
            allowDecimals={false}
            width={32}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<HistTooltip />} cursor={{ fill: "hsl(var(--accent))" }} />
          <Bar
            dataKey="count"
            fill="hsl(var(--primary))"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
