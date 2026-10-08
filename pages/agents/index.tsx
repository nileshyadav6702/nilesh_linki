import Head from "next/head";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { RiAddLine, RiArrowRightLine, RiDeleteBinLine, RiFileCopyLine, RiLinkedinBoxFill, RiMailLine, RiMore2Fill, RiPauseLine, RiPlayLine, RiSearchLine, RiSendPlane2Line } from "react-icons/ri";
import { Card, Empty, outreachLabel, PageHeader, primaryBtn, secondaryBtn, senderLine, sourcingLabel, timeAgo } from "@/components/agents/ui";
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

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [statusFor, setStatusFor] = useState<string | null>(null);
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
      <div className="space-y-8" onClick={() => { setMenu(null); setStatusFor(null); }}>
        <PageHeader eyebrow="AI SDR" title="Outreach Agents" subtitle="Each agent finds people and runs its own sequence."
          actions={
            <>
              {!!agents?.length && (
                <span className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-base-100 px-3 text-sm text-base-content/70">
                  <span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-success" : "bg-base-content/25"}`} />
                  {running} running
                </span>
              )}
              <Link href="/agents/new" className={primaryBtn}><RiAddLine size={16} /> Create an agent</Link>
            </>
          } />
        {agents === null ? <p className="text-sm text-base-content/40">Loading…</p> : agents.length === 0 ? (
          <Empty title="No agents yet">
            <p>Create an agent and it will find leads and run LinkedIn and email from one sequence.</p>
            <Link href="/agents/new" className={`${primaryBtn} mt-4`}><RiAddLine size={16} /> Create an agent</Link>
          </Empty>
        ) : (
          <div className="grid items-stretch gap-4 lg:grid-cols-2">
            {agents.map((a) => {
              const p = a.performance;
              const sourcing = a.status === "active";
              const outreach = !!a.outreach_enabled;
              const live = sourcing || outreach;
              const pool = a.sender_pool ?? { linkedin: 0, email: 0 };
              const sender = senderLine(a.senders.linkedin?.name, a.senders.email?.from_email, pool);
              const attached = !!(a.senders.linkedin || a.senders.email);
              return (
                <Card key={a.id} className="flex flex-col !p-0">
                  <div className="flex items-start justify-between gap-4 px-5 pt-5">
                    <div className="min-w-0">
                      <Link href={`/agents/${a.id}`} className="block truncate text-[17px] font-semibold tracking-[-0.02em] text-base-content hover:text-primary">{a.name}</Link>
                      <div className="relative mt-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="flex items-center gap-2"
                          aria-expanded={statusFor === a.id}
                          aria-label={`${sourcingLabel(a.status)}. ${outreachLabel(outreach)}`}
                          onClick={() => { setStatusFor(statusFor === a.id ? null : a.id); setMenu(null); }}
                        >
                          <Chip on={sourcing} icon={<RiSearchLine size={13} />} label="Sourcing" />
                          <Chip on={outreach} icon={<RiSendPlane2Line size={13} />} label="Outreach" />
                        </button>
                        {statusFor === a.id && (
                          <div className="absolute left-0 z-40 mt-2 w-[320px] rounded-2xl border border-[var(--border-subtle)] bg-base-100 p-3 shadow-[var(--shadow-overlay)]">
                            <p className="px-1 text-sm leading-5 text-base-content/70">{sourcingLabel(a.status)}. {outreachLabel(outreach)}.</p>
                            <Toggle label="Lead sourcing" hint="Finds new leads that match this agent" on={sourcing} onChange={() => patch(a.id, { status: sourcing ? "paused" : "active" }, sourcing ? "Lead sourcing paused" : "Lead sourcing on")} />
                            <Toggle label="Outreach" hint="Sends the sequence to approved leads" on={outreach} onChange={() => patch(a.id, { outreach_enabled: !outreach }, outreach ? "Outreach paused" : "Outreach on")} />
                            <button type="button" className="mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border-subtle)] text-xs font-medium hover:bg-base-200" onClick={() => patch(a.id, live ? { status: "paused", outreach_enabled: false } : { status: "active" }, live ? "Lead sourcing and outreach paused" : "Lead sourcing on")}>
                              {live ? <RiPauseLine size={13} /> : <RiPlayLine size={13} />}
                              {live ? "Pause both" : "Start sourcing"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <Link href={`/agents/${a.id}`} className={secondaryBtn + " !h-9"}>Open <RiArrowRightLine size={15} /></Link>
                      <div className="relative">
                        <button type="button" className="flex h-9 w-9 items-center justify-center rounded-[10px] text-base-content/45 hover:bg-base-200 hover:text-base-content" aria-label="Agent actions" onClick={() => { setMenu(menu === a.id ? null : a.id); setStatusFor(null); }}>
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
                  </div>

                  <div className="grid grid-cols-4 gap-3 px-5 pb-5 pt-6">
                    <Metric label="Contacted" value={String(p.contacted)} />
                    <Metric label="Accepted" value={pct(p.accepted, p.contacted)} />
                    <Metric label="Replied" value={p.contacted ? pct(p.replied, p.contacted) : "—"} />
                    <Metric label="Interested" value={String(p.interested)} />
                  </div>
                  <p className="px-5 pb-4 text-xs text-base-content/45">{activityLine(p)}</p>

                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-5 py-3.5">
                    <div className="flex min-w-0 items-center gap-2 text-sm text-base-content/75">
                      {a.senders.linkedin && <RiLinkedinBoxFill className="shrink-0 text-[#0a66c2]" size={16} />}
                      {a.senders.email && <RiMailLine className="shrink-0 text-error" size={16} />}
                      {!attached && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
                      <span className="truncate">{sender}</span>
                    </div>
                    <span className="shrink-0 text-xs text-base-content/40">Created {timeAgo(a.created_at)}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function activityLine(p: AgentRow["performance"]): string {
  if (!p.found && !p.contacted) return "No leads yet";
  if (!p.contacted) return `${p.found} found · nothing sent yet`;
  const parts = [`${p.contacted} of ${p.found} contacted`];
  if (p.accepted) parts.push(`${pct(p.accepted, p.contacted)} accepted`);
  if (p.replied) parts.push(`${pct(p.replied, p.contacted)} replied`);
  if (p.interested) parts.push(`${p.interested} interested`);
  return parts.join(" · ");
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium text-base-content/45">{label}</div>
      <div className="mt-1.5 text-[22px] font-semibold tabular-nums leading-none tracking-[-0.03em]">{value}</div>
    </div>
  );
}

function Chip({ on, icon, label }: { on: boolean; icon: ReactNode; label: string }) {
  return (
    <span className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${on ? "border-success/30 bg-success/10 text-success" : "border-[var(--border-subtle)] bg-base-200/70 text-base-content/50"}`}>
      {icon}
      {label}
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-success" : "bg-base-content/25"}`} />
    </span>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: () => void }) {
  return (
    <div className="mt-2 flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label} <span className={`ml-1 text-xs font-medium ${on ? "text-success" : "text-base-content/35"}`}>{on ? "On" : "Off"}</span></div>
        <div className="text-xs text-base-content/50">{hint}</div>
      </div>
      <input type="checkbox" className="toggle toggle-sm toggle-success" checked={on} onChange={onChange} aria-label={label} />
    </div>
  );
}
