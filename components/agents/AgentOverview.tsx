import { Card, SignalChip, timeAgo } from "@/components/agents/ui";

export interface FunnelRow { signal_type: string; label: string; detected: number; qualified: number; contacted: number; accepted: number; replied: number; positive: number; meetings: number }
export interface DetectorRun { id: string; source_type: string; started_at: string; candidates: number; ingested: number; filtered: number; linkedin_requests: number; error: string | null }
export interface Budget { paused: { until: string; reason: string } | null; usage: Record<string, { used: number; limit: number }> }

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

/** Agent overview: today's numbers, the per-signal funnel, LinkedIn budget and detector runs. */
export default function AgentOverview({ counts, funnel, runs, budget }: {
  counts: { by_status: Record<string, number>; today: Record<string, number>; ai_cost_30d_usd: number };
  funnel: FunnelRow[]; runs: DetectorRun[]; budget: Budget | null;
}) {
  const total = (k: keyof FunnelRow) => funnel.reduce((s, r) => s + Number(r[k]), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["Found today", counts.today.discovered], ["Qualified today", counts.today.qualified], ["Contacted today", counts.today.enrolled], ["To review", counts.today.pending_approvals], ["AI cost, 30d", `$${counts.ai_cost_30d_usd.toFixed(2)}`]].map(([label, v]) => (
          <Card key={String(label)} className="!p-4"><div className="text-2xl font-semibold tabular-nums">{v}</div><div className="text-xs text-base-content/50">{label}</div></Card>
        ))}
      </div>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">What each signal turns into</h2>
        {funnel.length === 0 ? <p className="text-sm text-base-content/45">No signals yet. Sources run on their schedule; LinkedIn sources run during the account&apos;s active hours.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-base-content/45">
                <tr>{["Signal", "Detected", "Qualified", "Contacted", "Accepted", "Replied", "Positive", "Meetings"].map((h) => <th key={h} className="pb-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="tabular-nums">
                {funnel.map((r) => (
                  <tr key={r.signal_type} className="border-t border-[var(--border-subtle)]">
                    <td className="py-2"><SignalChip type={r.signal_type} /></td>
                    <td>{r.detected}</td><td>{r.qualified} <span className="text-xs text-base-content/40">{pct(r.qualified, r.detected)}</span></td>
                    <td>{r.contacted}</td><td>{r.accepted}</td><td>{r.replied} <span className="text-xs text-base-content/40">{pct(r.replied, r.contacted)}</span></td>
                    <td>{r.positive}</td><td className="font-semibold">{r.meetings}</td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--border-strong)] font-semibold">
                  <td className="py-2">All</td><td>{total("detected")}</td><td>{total("qualified")}</td><td>{total("contacted")}</td><td>{total("accepted")}</td><td>{total("replied")}</td><td>{total("positive")}</td><td>{total("meetings")}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">LinkedIn discovery budget today</h2>
          {!budget ? <p className="text-sm text-base-content/45">No LinkedIn account on this agent.</p> : (
            <>
              {budget.paused && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">Paused until {new Date(budget.paused.until).toLocaleString()} — {budget.paused.reason}</p>}
              {Object.entries(budget.usage).map(([k, u]) => (
                <div key={k} className="space-y-1">
                  <div className="flex justify-between text-xs"><span className="capitalize text-base-content/60">{k.replace("_", " ")}</span><span className="tabular-nums">{u.used} / {u.limit}</span></div>
                  <div className="h-1.5 rounded-full bg-base-200"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.min(100, (u.used / u.limit) * 100)}%` }} /></div>
                </div>
              ))}
            </>
          )}
        </Card>
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Recent detector runs</h2>
          {runs.length === 0 ? <p className="text-sm text-base-content/45">None yet.</p> : runs.slice(0, 8).map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
              <SignalChip type={r.source_type} />
              <span className="flex-1 truncate text-base-content/55">{r.error ? <span className="text-error">{r.error}</span> : `${r.ingested} new · ${r.filtered} filtered · ${r.linkedin_requests} requests`}</span>
              <span className="shrink-0 text-base-content/40">{timeAgo(r.started_at)}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
