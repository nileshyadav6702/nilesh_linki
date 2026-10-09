import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { format, parseISO } from "date-fns";

/**
 * Daily trend chart (Recharts) used across the app: smooth lines, a soft gradient under the
 * first series, and a dated tooltip listing every series. Rows need a "YYYY-MM-DD" `day`.
 */

export interface ChartSeries { key: string; label: string; color: string }

const AXIS = { fontSize: 14, fill: "color-mix(in oklab, var(--color-base-content) 75%, transparent)" };

function Tip({ active, payload, label, series }: Partial<TooltipContentProps<number, string>> & { series: ChartSeries[] }) {
  if (!active || !payload?.length) return null;
  const value = (key: string) => Number(payload.find((p) => p.dataKey === key)?.value ?? 0);
  return (
    <div className="min-w-[180px] overflow-hidden rounded-[8px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
      <div className="border-b border-[var(--border-subtle)] bg-base-200/60 px-3 py-2 text-[14px] text-base-content/75">{format(parseISO(String(label)), "MMM d, yyyy")}</div>
      <div className="space-y-1.5 px-3 py-2.5">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-[14px]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            <span className="text-base-content/75">{s.label}:</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums">{value(s.key).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TrendChart<T extends { day: string }>({ data, series, height = 340, compact = false }: {
  data: T[]; series: ChartSeries[]; height?: number; compact?: boolean;
}) {
  const gid = `g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // About 15 labels along the bottom (8 when compact).
  const interval = Math.max(0, Math.ceil(data.length / (compact ? 8 : 15)) - 1);
  const tick = compact ? { ...AXIS, fontSize: 12 } : AXIS;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={series[0]?.color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={series[0]?.color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} interval={interval} tickMargin={12} tick={tick}
          tickFormatter={(d: string) => format(parseISO(d), "MMM d")} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={compact ? 36 : 44} tickMargin={8} tick={tick} />
        <Tooltip cursor={{ stroke: "color-mix(in oklab, var(--color-base-content) 35%, transparent)", strokeDasharray: "4 4" }}
          content={(p) => <Tip {...(p as Partial<TooltipContentProps<number, string>>)} series={series} />} />
        {series.map((s, i) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={i ? 1.75 : 2.25}
            fill={i ? "transparent" : `url(#${gid})`} activeDot={{ r: i ? 4 : 5, fill: s.color, stroke: "var(--color-base-100)", strokeWidth: 2 }}
            animationDuration={700} animationEasing="ease-out" />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
