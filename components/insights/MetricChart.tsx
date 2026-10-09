import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { format, parseISO } from "date-fns";

/** One metric over time: a smooth line with a soft gradient under it, and a dated tooltip. */

export interface ChartSeries { key: string; label: string; color: string }

function Tip({ active, payload, label, series }: Partial<TooltipContentProps<number, string>> & { series: ChartSeries }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[180px] overflow-hidden rounded-[8px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
      <div className="border-b border-[var(--border-subtle)] bg-base-200/60 px-3 py-2 text-[14px] text-base-content/75">{format(parseISO(String(label)), "MMM d, yyyy")}</div>
      <div className="flex items-center gap-2 px-3 py-2.5 text-[14px]">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: series.color }} />
        <span className="text-base-content/75">{series.label}:</span>
        <span className="ml-auto pl-3 font-semibold tabular-nums">{Number(payload[0].value ?? 0).toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function MetricChart<T extends { day: string }>({ data, series, height = 340 }: { data: T[]; series: ChartSeries; height?: number }) {
  const gid = `g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // About 15 labels at most along the bottom.
  const interval = Math.max(0, Math.ceil(data.length / 15) - 1);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={series.color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={series.color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} interval={interval} tickMargin={12}
          tick={{ fontSize: 14, fill: "color-mix(in oklab, var(--color-base-content) 75%, transparent)" }}
          tickFormatter={(d: string) => format(parseISO(d), "MMM d")} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} tickMargin={8}
          tick={{ fontSize: 14, fill: "color-mix(in oklab, var(--color-base-content) 75%, transparent)" }} />
        <Tooltip cursor={{ stroke: "color-mix(in oklab, var(--color-base-content) 35%, transparent)", strokeDasharray: "4 4" }}
          content={(p) => <Tip {...(p as Partial<TooltipContentProps<number, string>>)} series={series} />} />
        <Area key={series.key} type="monotone" dataKey={series.key} name={series.label} stroke={series.color} strokeWidth={2.25}
          fill={`url(#${gid})`} activeDot={{ r: 5, fill: series.color, stroke: "var(--color-base-100)", strokeWidth: 2 }}
          animationDuration={700} animationEasing="ease-out" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
