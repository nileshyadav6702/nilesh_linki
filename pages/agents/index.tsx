import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import {
  RiAddLine, RiArrowRightSLine, RiBroadcastLine, RiDeleteBinLine, RiFileCopyLine, RiLinkedinBoxFill, RiMailLine, RiMore2Fill, RiRobot2Line, RiTeamLine,
} from "react-icons/ri";
import { Avatar, Empty, IconTile, Panel, primaryBtn, RunSwitch, senderLine } from "@/components/agents/ui";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

interface SenderLinkedIn { id: string; name: string | null; email: string | null }
interface SenderEmail { id: string; from_email: string | null; from_name: string | null }
interface AgentRow {
  id: string; name: string; status: string; outreach_enabled: number; created_at: string;
  performance: { found: number; contacted: number; accepted: number; replied: number; interested: number };
  senders: { linkedin: SenderLinkedIn | null; email: SenderEmail | null };
  sender_pool: { linkedin: number; email: number };
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "—");
const created = (iso: string) => {
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const load = () => fetch("/api/agents").then((r) => r.json()).then(setAgents).catch(() => setAgents([]));
  useEffect(() => { load(); }, []);

  async function patch(id: string, body: Record<string, unknown>, ok: string) {
    const r = await fetch(`/api/agents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return toast.error((await r.json()).error ?? "Could not update agent");
    toast.success(ok);
    load();
  }

  async function duplicate(id: string) {
    setMenu(null);
    const r = await fetch(`/api/agents/${id}/duplicate`, { method: "POST" });
    const data = await r.json();
    if (!r.ok) return toast.error(data.error ?? "Could not duplicate");
    toast.success("Agent duplicated");
    router.push(`/agents/${data.id}`);
  }

  async function remove(a: AgentRow) {
    setMenu(null);
    if (!confirm(`Delete ${a.name}? Its leads stay; this agent stops finding and sending.`)) return;
    await fetch(`/api/agents/${a.id}`, { method: "DELETE" });
    toast.success("Agent deleted");
    load();
  }

  const running = agents?.filter((a) => a.status === "active" || a.outreach_enabled).length ?? 0;

  return (
    <>
      <Head><title>Outreach Agents — Linki</title></Head>
      <div className="space-y-8" onClick={() => setMenu(null)}>
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--border-subtle)] pb-6 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <IconTile icon={<RiBroadcastLine size={20} />} size={40} />
            <div className="min-w-0">
              <h1 className="font-display text-[28px] leading-[1.15] text-base-content">Outreach Agents</h1>
              <p className="mt-0.5 text-sm text-base-content/55">Each agent finds people and runs its own sequence.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!!agents?.length && (
              <span className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3.5 text-sm text-base-content/70">
                <RiTeamLine size={16} className="text-primary" />
                <span className="font-semibold tabular-nums text-base-content">{running} / {agents.length}</span> running agents
              </span>
            )}
            <Link href="/agents/new" className={primaryBtn}><RiAddLine size={16} /> Create an agent</Link>
          </div>
        </div>

        {agents === null ? <p className="text-sm text-base-content/40">Loading…</p> : agents.length === 0 ? (
          <Empty title="No agents yet">
            <IconTile icon={<RiRobot2Line size={24} />} size={48} className="mx-auto mb-3" />
            <p>Create an agent and it will find leads and run LinkedIn and email from one sequence.</p>
            <Link href="/onboarding" className={`${primaryBtn} mt-4`}><RiAddLine size={16} /> Create an agent</Link>
          </Empty>
        ) : (
          <div className="grid items-stretch gap-5 xl:grid-cols-2">
            {agents.map((a) => {
              const p = a.performance;
              const sourcing = a.status === "active";
              const outreach = !!a.outreach_enabled;
              const pool = a.sender_pool ?? { linkedin: 0, email: 0 };
              const sender = senderLine(a.senders.linkedin?.name, a.senders.email?.from_email, pool);
              const attached = !!(a.senders.linkedin || a.senders.email);
              return (
                <Panel key={a.id} className="flex flex-col transition-shadow hover:shadow-[0_1px_3px_rgba(20,20,19,0.08)]">
                  <div className="flex items-start justify-between gap-4 px-6 pt-6">
                    <div className="min-w-0">
                      <Link href={`/agents/${a.id}`} className="block truncate text-[17px] font-semibold tracking-[-0.01em] text-base-content hover:text-primary">{a.name}</Link>
                      <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                        <RunSwitch label="Sourcing" on={sourcing} onChange={() => patch(a.id, { status: sourcing ? "paused" : "active" }, sourcing ? "Lead sourcing paused" : "Lead sourcing on")} />
                        <RunSwitch label="Outreach" on={outreach} onChange={() => patch(a.id, { outreach_enabled: !outreach }, outreach ? "Outreach paused" : "Outreach on")} />
                      </div>
                    </div>
                    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="flex h-9 w-9 items-center justify-center rounded-[8px] text-base-content/45 hover:bg-base-200 hover:text-base-content" aria-label="Agent actions" onClick={() => setMenu(menu === a.id ? null : a.id)}>
                        <RiMore2Fill size={18} />
                      </button>
                      {menu === a.id && (
                        <div className="absolute right-0 z-40 mt-1 w-40 rounded-xl border border-[var(--border-subtle)] bg-base-100 py-1 shadow-[var(--shadow-overlay)]">
                          <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-base-200" onClick={() => duplicate(a.id)}><RiFileCopyLine size={15} /> Duplicate</button>
                          <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-base-200" onClick={() => remove(a)}><RiDeleteBinLine size={15} /> Delete</button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-5 px-6 pb-6 pt-7 sm:grid-cols-4">
                    <Metric label="Contacted" value={String(p.contacted)} of={p.found ? `/ ${p.found}` : undefined} hint={p.found ? `${pct(p.contacted, p.found)} contacted` : "no leads yet"} />
                    <Metric label="Accepted" value={pct(p.accepted, p.contacted)} hint="accept rate" />
                    <Metric label="Replied" value={p.contacted ? pct(p.replied, p.contacted) : "—"} hint="reply rate" />
                    <Metric label="Interested" value={p.interested ? String(p.interested) : "—"} hint="interested leads" />
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-6 py-4">
                    <div className="flex min-w-0 items-center gap-2.5 text-sm text-base-content/75">
                      {(a.senders.linkedin || a.senders.email) && (
                        <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] px-2.5">
                          {a.senders.linkedin && <RiLinkedinBoxFill className="text-[#0a66c2]" size={15} />}
                          {a.senders.linkedin && a.senders.email && <span className="h-3 w-px bg-[var(--border-subtle)]" />}
                          {a.senders.email && <RiMailLine className="text-error" size={15} />}
                        </span>
                      )}
                      {attached ? <Avatar name={sender} size={26} /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
                      <span className="truncate">{sender}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="hidden text-xs text-base-content/45 sm:inline">Created on {created(a.created_at)}</span>
                      <Link href={`/agents/${a.id}`} className={`${primaryBtn} !h-9 !px-4`}>Open <RiArrowRightSLine size={16} /></Link>
                    </div>
                  </div>
                </Panel>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function Metric({ label, value, of, hint }: { label: string; value: string; of?: string; hint: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-[1.2px] text-base-content/45">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="font-display text-[30px] leading-none tabular-nums text-base-content">{value}</span>
        {of && <span className="text-sm tabular-nums text-base-content/40">{of}</span>}
      </div>
      <div className="mt-1.5 truncate text-xs text-base-content/45">{hint}</div>
    </div>
  );
}
