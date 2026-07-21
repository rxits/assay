// Usage chart — 05 §4.7d + §5.3. Daily AccessEvent counts from GET /datasets/:id/usage
// (zero-filled by the API). Single blue hue, one axis, vertical crosshair tooltip
// listing the value at the nearest date. Two variants:
//  - "full"  axes + grid + crosshair tooltip (the detail-page figure).
//  - "spark" tiny area, no axes/tooltip, muted line + a --primary end-dot (05 §4.7d).
// Category/series text is set via React children (textContent), never innerHTML (§5.2).
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import { Activity } from "lucide-react";
import type { UsageSeries } from "@assay/shared";
import { ChartEmpty } from "@/components/charts/chart-shell";
import { formatCompact, formatDateShort } from "@/lib/format";

const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };

function UsageTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value ?? 0;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md">
      <div className="tabular-nums text-[13px] font-medium text-foreground">
        {formatCompact(Number(value))} {Number(value) === 1 ? "view" : "views"}
      </div>
      <div className="text-[12px] text-muted-foreground">{formatDateShort(String(label))}</div>
    </div>
  );
}

interface UsageChartProps {
  usage: UsageSeries;
  variant?: "full" | "spark";
  height?: number;
}

export function UsageChart({ usage, variant = "full", height }: UsageChartProps) {
  const data = usage.series;
  const totalAccesses = usage.summary.accesses90d;

  if (variant === "spark") {
    const h = height ?? 32;
    if (totalAccesses === 0) {
      return <div style={{ height: h }} aria-hidden="true" />;
    }
    return (
      <span role="img" aria-label={`Usage sparkline — ${totalAccesses} accesses in 90 days`}>
        <ResponsiveContainer width="100%" height={h}>
          <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <defs>
              <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.18} />
                <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="total"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1.5}
              fill="url(#spark-fill)"
              isAnimationActive={false}
              dot={false}
              activeDot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </span>
    );
  }

  const h = height ?? 200;
  if (totalAccesses === 0) {
    return <ChartEmpty icon={Activity} message="No access events yet" height={h} />;
  }

  return (
    <div role="img" aria-label={`Daily accesses — ${totalAccesses} in the last 90 days`}>
      <ResponsiveContainer width="100%" height={h}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
          <defs>
            <linearGradient id="usage-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeWidth={1} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateShort}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "hsl(var(--border))" }}
            minTickGap={40}
          />
          <YAxis
            allowDecimals={false}
            width={40}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatCompact(v)}
          />
          <Tooltip
            content={<UsageTooltip />}
            cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill="url(#usage-fill)"
            isAnimationActive={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
