import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RiAddLine, RiPauseLine, RiPlayLine, RiRobot2Line } from "react-icons/ri";
import { Card, Empty, PageHeader, primaryBtn, ghostBtn, SignalChip, StatusDot, timeAgo } from "@/components/agents/ui";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

interface AgentRow {
  id: string; name: string; status: string; mode: string; last_run_at: string | null; last_error: string | null; daily_lead_cap: number;
  counts: { today: { discovered: number; qualified: number; enrolled: number; pending_approvals: number } };
  sources: Array<{ source_type: string; enabled: number }>;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const load = () => fetch("/api/agents").then((r) => r.json()).then(setAgents).catch(() => setAgents([]));
  useEffect(() => { load(); }, []);

  async function toggle(a: AgentRow) {
    const status = a.status === "active" ? "paused" : "active";
    const r = await fetch(`/api/agents/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (!r.ok) return toast.error((await r.json()).error ?? "Could not update agent");
    toast.success(status === "active" ? "Agent running" : "Agent paused");
    load();
  }

  return (
    <>
      <Head><title>Agents — Linki</title></Head>
      <div className="space-y-6">
        <PageHeader eyebrow="AI SDR" title="Agents" subtitle="Each agent watches buying signals, qualifies people and starts conversations."
          actions={<Link href="/onboarding" className={primaryBtn}><RiAddLine size={16} /> New agent</Link>} />
        {agents === null ? <p className="text-sm text-base-content/40">Loading…</p> : agents.length === 0 ? (
          <Empty title="No agents yet">
            <p>Give Linki your website and it will build your ICP and find people already showing intent.</p>
            <Link href="/onboarding" className={`${primaryBtn} mt-4`}><RiRobot2Line size={16} /> Launch your first agent</Link>
          </Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {agents.map((a) => (
              <Card key={a.id} className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/agents/${a.id}`} className="block truncate text-base font-semibold hover:underline">{a.name}</Link>
                    <div className="mt-1 flex items-center gap-3 text-xs text-base-content/50">
                      <StatusDot status={a.status} /><span className="capitalize">{a.mode}</span><span>Last run {timeAgo(a.last_run_at)}</span>
                    </div>
                  </div>
                  <button className={ghostBtn} onClick={() => toggle(a)}>{a.status === "active" ? <><RiPauseLine size={14} /> Pause</> : <><RiPlayLine size={14} /> Run</>}</button>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[["Found", a.counts.today.discovered], ["Qualified", a.counts.today.qualified], ["Contacted", a.counts.today.enrolled], ["To review", a.counts.today.pending_approvals]].map(([label, n]) => (
                    <div key={label} className="rounded-xl bg-base-200 px-2 py-2.5">
                      <div className="text-lg font-semibold tabular-nums">{n}</div>
                      <div className="text-[11px] text-base-content/50">{label}{label !== "To review" ? " today" : ""}</div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">{a.sources.filter((s) => s.enabled).map((s) => <SignalChip key={s.source_type} type={s.source_type} />)}</div>
                {a.last_error && <p className="rounded-lg bg-error/5 px-3 py-2 text-xs text-error">{a.last_error}</p>}
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
