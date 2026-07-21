// Type distribution — 05 §4.7b. Count of columns per dataType as a horizontal bar
// list, single blue hue (nominal categories — magnitude shown by length, never by
// colouring bars by their value), sorted desc. One series → no legend (05 §5.1).
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import { Columns3 } from "lucide-react";
import type { ColumnDTO, DataType } from "@assay/shared";
import { ChartEmpty } from "@/components/charts/chart-shell";

function TypeTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as { type: string; count: number } | undefined;
  if (!row) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md">
      <span className="text-[13px] text-foreground">
        <span className="font-medium">{row.type}</span>
        <span className="tabular-nums text-muted-foreground">
          {" "}
          · {row.count} {row.count === 1 ? "column" : "columns"}
        </span>
      </span>
    </div>
  );
}

export function TypeDistribution({ columns }: { columns: ColumnDTO[] }) {
  const counts = new Map<DataType, number>();
  for (const c of columns) counts.set(c.dataType, (counts.get(c.dataType) ?? 0) + 1);
  const data = [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  if (data.length === 0) {
    return <ChartEmpty icon={Columns3} message="No columns to chart" height={120} />;
  }

  const height = data.length * 30 + 16;
  return (
    <div role="img" aria-label={`Column types — ${data.map((d) => `${d.count} ${d.type}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart layout="vertical" data={data} margin={{ top: 0, right: 28, bottom: 0, left: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="type"
            width={78}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          />
          <Tooltip content={<TypeTooltip />} cursor={{ fill: "hsl(var(--accent))" }} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.type} fill="hsl(var(--primary))" />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              fill="hsl(var(--foreground))"
              fontSize={11}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
