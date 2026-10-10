import Head from "next/head";
import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { format, parseISO, subDays } from "date-fns";
import { toast } from "sonner";
import { LuChartBarDecreasing } from "react-icons/lu";
import { RiArrowDownSLine, RiCalendarLine, RiLineChartLine, RiUploadLine } from "react-icons/ri";
import Listbox, { useDismiss } from "@/components/agents/leads/Listbox";
import { DateRangeCalendar, toDay } from "@/components/ui/DateRangePicker";
import TrendChart, { type ChartSeries } from "@/components/ui/TrendChart";
import { AgentTable, ChannelTable, SourceTable } from "@/components/insights/Tables";
import { Card, HELP, InfoTip, LoadingPill, categoryLabel, rate } from "@/components/insights/kit";
import { requireSignedIn } from "@/lib/agents/page-auth";
import type { InsightsReport } from "@/lib/insights/report";

export const getServerSideProps = requireSignedIn;

type Metric = "found" | "contacted" | "replied" | "interested";
type Range = "7" | "30" | "custom";
interface Data extends InsightsReport { agentOptions: Array<{ id: string; name: string; status: string }> }

const SERIES: Record<Metric, ChartSeries> = {
  found: { key: "found", label: "New leads", color: "#36b38f" },
  contacted: { key: "contacted", label: "Contacted", color: "#c64fe0" },
  replied: { key: "replied", label: "Replied", color: "#4c7cf3" },
  interested: { key: "interested", label: "Interested", color: "#ee7a4c" },
};

const lastDays = (n: number) => ({ from: toDay(subDays(new Date(), n - 1)), to: toDay(new Date()) });
const rangeLabel = (r: Range, p: { from: string; to: string }) => {
  if (r !== "custom") return `Last ${r} days`;
  const a = parseISO(p.from), b = parseISO(p.to);
  return a.getFullYear() === b.getFullYear() ? `${format(a, "MMM d")} – ${format(b, "MMM d, yyyy")}` : `${format(a, "MMM d, yyyy")} – ${format(b, "MMM d, yyyy")}`;
};

function download(name: string, rows: Array<Record<string, unknown>>) {
  const url = URL.createObjectURL(new Blob([Papa.unparse(rows)], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** What is working, what is not: leads found, contacted, replied and interested, by agent, source and step. */
export default function Insights() {
  const [agent, setAgent] = useState("");
  const [range, setRange] = useState<Range>("30");
  const [period, setPeriod] = useState(lastDays(30));
  const [metric, setMetric] = useState<Metric>("found");
  const [data, setData] = useState<Data | null>(null);
  // Loading = the data on screen is for an older agent / period than the one picked.
  const want = JSON.stringify([agent, period]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== want;
  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pickRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  useDismiss(picking, [pickRef], () => setPicking(false));
  useDismiss(exporting, [exportRef], () => setExporting(false));

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/insights?${new URLSearchParams({ ...(agent ? { agent } : {}), ...period })}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Could not load insights"))))
      .then((d: Data) => { setData(d); setLoadedFor(want); })
      .catch((err) => { if (!ctl.signal.aborted) { setLoadedFor(want); toast.error(err instanceof Error ? err.message : "Could not load insights"); } });
    return () => ctl.abort();
  }, [agent, period, want]);

  const agentName = data?.agentOptions.find((a) => a.id === agent)?.name ?? null;
  const scopeLabel = agentName ?? "All agents";
  const o = data?.overview ?? { found: 0, contacted: 0, messaged: 0, replied: 0, interested: 0 };
  const empty = useMemo(() => !!data && data.series.every((d) => !d.found && !d.contacted && !d.replied && !d.interested), [data]);

  function pickRange(r: Exclude<Range, "custom">) { setRange(r); setPeriod(lastDays(Number(r))); setPicking(false); }

  function exportCsv(kind: "overview" | "agents" | "sources" | "channels") {
    setExporting(false);
    if (!data) return;
    const stamp = `${data.period.from}_${data.period.to}`;
    if (kind === "overview") download(`insights-daily-${stamp}.csv`, data.series.map((d) => ({ date: d.day, leads_found: d.found, contacted: d.contacted, replied: d.replied, interested: d.interested })));
    if (kind === "agents") download(`insights-agents-${stamp}.csv`, data.agents.map((a) => ({ agent: a.name, status: a.status, found: a.found, contacted: a.contacted, replied: a.replied, reply_rate: rate(a.replied, a.messaged), interested: a.interested, interested_rate: rate(a.interested, a.replied) })));
    if (kind === "sources") download(`insights-lead-sources-${stamp}.csv`, data.sources.map((s) => ({ source: s.name, type: categoryLabel(s.category), leads: s.leads, replied: s.replied, interested: s.interested })));
    if (kind === "channels") download(`insights-channels-${stamp}.csv`, data.channels.flatMap((c) => [
      { step: c.channel === "linkedin" ? "LinkedIn" : "Email", sent: c.sent, accepted: "", replied: c.replied, reply_rate: rate(c.replied, c.messaged) },
      ...c.steps.map((s) => ({ step: `Step ${s.n} · ${s.label}`, sent: s.sent, accepted: s.accepted ?? "", replied: s.replied, reply_rate: "" })),
    ]));
  }

  const tiles: Array<{ id: Metric; label: string; value: number; sub?: string; help?: string }> = [
    { id: "found", label: "Leads found", value: o.found, sub: "across all channels" },
    { id: "contacted", label: "Contacted", value: o.contacted, help: HELP.contacted },
    { id: "replied", label: "Replied", value: o.replied, sub: `${rate(o.replied, o.messaged)} reply rate`, help: HELP.replied },
    { id: "interested", label: "Interested", value: o.interested, sub: `${rate(o.interested, o.replied)} of replies`, help: HELP.interested },
  ];
  const pill = (on: boolean) => `inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[15px] transition ${on ? "bg-base-100 text-base-content shadow-[0_1px_3px_rgba(20,20,19,0.12)]" : "text-base-content/70 hover:text-base-content"}`;

  return (
    <>
      <Head><title>Insights — Kairo</title></Head>
      <div className="sticky top-16 z-30 -mx-4 -mt-6 mb-6 border-b border-[var(--border-subtle)] bg-base-100 px-4 pb-4 pt-5 md:top-0 md:-mx-10 md:-mt-9 md:px-10 md:pt-7">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div>
            <div className="flex items-center gap-3"><LuChartBarDecreasing size={22} className="text-primary" /><div role="heading" aria-level={1} className="text-[24px] font-medium">Insights</div></div>
            <div className="mt-1 pl-1 text-[16px] text-base-content/65">What is working, what is not - across agents, signals and messages</div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Listbox label="Agent" className="w-[286px] max-w-full [&>button]:h-11 [&>button]:text-[15px]" value={agent} onChange={setAgent}
              options={[{ value: "", label: "All agents" }, ...(data?.agentOptions ?? []).map((a) => ({ value: a.id, label: a.name }))]} />
            <div ref={pickRef} className="relative">
              <div role="group" aria-label="Period" className="flex h-11 items-center gap-0.5 rounded-full bg-base-200 p-1">
                <button type="button" aria-pressed={range === "7"} className={pill(range === "7")} onClick={() => pickRange("7")}>7 days</button>
                <button type="button" aria-pressed={range === "30"} className={pill(range === "30")} onClick={() => pickRange("30")}>30 days</button>
                <button type="button" aria-pressed={range === "custom"} aria-expanded={picking} className={pill(range === "custom" || picking)} onClick={() => setPicking((v) => !v)}>
                  <RiCalendarLine size={16} />Select dates
                </button>
              </div>
              {picking && (
                <div className="pop-in absolute right-0 top-full z-50 mt-2 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
                  <DateRangeCalendar value={range === "custom" ? period : null} onChange={(p) => { setRange("custom"); setPeriod(p); setPicking(false); }} />
                </div>
              )}
            </div>
            <div ref={exportRef} className="relative">
              <button type="button" aria-haspopup="menu" aria-expanded={exporting} onClick={() => setExporting((v) => !v)} disabled={!data}
                className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-base-100 px-4 text-[15px] hover:bg-base-200/60 disabled:opacity-50">
                <RiUploadLine size={17} />Export<RiArrowDownSLine size={20} className={`transition-transform ${exporting ? "rotate-180" : ""}`} />
              </button>
              {exporting && (
                <div role="menu" className="pop-in absolute right-0 top-full z-50 mt-2 w-[240px] rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1 shadow-[var(--shadow-overlay)]">
                  {([["overview", "Daily overview"], ...(agent ? [["channels", "Channel performance"]] : [["agents", "Agent performance"]]), ["sources", "Lead source performance"]] as Array<[Parameters<typeof exportCsv>[0], string]>).map(([k, label]) => (
                    <button key={k} type="button" role="menuitem" onClick={() => exportCsv(k)} className="flex w-full items-center rounded-[8px] px-3 py-2.5 text-left text-[14px] hover:bg-base-200">{label} (CSV)</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="relative">
        {loading && <LoadingPill />}
        <div className={`space-y-6 transition-opacity duration-200 ${loading ? "pointer-events-none opacity-55" : ""}`} aria-busy={loading}>
          <Card title="Overview" sub={<>{scopeLabel}<span className="mx-2">·</span>{rangeLabel(range, period)}</>}>
            <div role="tablist" aria-label="Metric" className="grid grid-cols-2 border-b border-[var(--border-subtle)] lg:grid-cols-4">
              {tiles.map((t, i) => {
                const on = metric === t.id;
                return (
                  <div key={t.id} role="tab" tabIndex={0} aria-selected={on} onClick={() => setMetric(t.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMetric(t.id); } }}
                    className={`relative cursor-pointer px-6 pb-5 pt-6 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] ${i ? "border-l border-dashed border-[var(--border-subtle)]" : ""} ${on ? "bg-primary/[0.06]" : "hover:bg-base-200/40"}`}>
                    <div className="flex items-center gap-1.5 text-[16px] text-base-content/60">{t.label}{t.help && <InfoTip text={t.help} align={i === 3 ? "right" : "center"} />}</div>
                    <div className="mt-1 text-[42px] font-bold leading-[1.15] tabular-nums tracking-tight text-base-content">{t.value.toLocaleString()}</div>
                    {t.sub && <div className="mt-1 text-[15px] text-base-content/55">{t.sub}</div>}
                    <span className={`absolute inset-x-0 bottom-[-1px] h-[2px] bg-primary transition-transform duration-200 ease-out ${on ? "scale-x-100" : "scale-x-0"}`} />
                  </div>
                );
              })}
            </div>
            <div className="px-4 pb-4 pt-6 sm:px-6">
              {empty ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                  <RiLineChartLine size={34} className="text-base-content/45" />
                  <div className="text-[20px] font-medium">No activity in this period</div>
                  <div className="text-[16px] text-base-content/60">Once your agents find and contact leads, their performance will show up here.</div>
                </div>
              ) : data ? <TrendChart key={`${metric}:${data.period.from}:${data.period.to}:${agent}`} data={data.series} series={[SERIES[metric]]} /> : <div className="h-[340px]" />}
            </div>
          </Card>

          {data && (agent
            ? <ChannelTable rows={data.channels} sub={agentName ?? undefined} />
            : <AgentTable rows={data.agents} onPick={(id) => { setAgent(id); window.scrollTo({ top: 0, behavior: "smooth" }); }} />)}
          {data && <SourceTable rows={data.sources} sub={agentName ?? undefined} />}
        </div>
      </div>
    </>
  );
}
