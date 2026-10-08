import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { RiAddLine, RiDeleteBinLine, RiFileCopyLine, RiLinkedinBoxFill, RiMailLine, RiMore2Fill, RiPauseLine } from "react-icons/ri";
import { Card, Empty, PageHeader, primaryBtn, timeAgo } from "@/components/agents/ui";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

interface SenderLinkedIn { id: string; name: string | null; email: string | null }
interface SenderEmail { id: string; from_email: string | null; from_name: string | null }
interface AgentRow {
  id: string; name: string; status: string; outreach_enabled: number; created_at: string;
  performance: { found: number; contacted: number; accepted: number; replied: number; interested: number };
  senders: { linkedin: SenderLinkedIn | null; email: SenderEmail | null };
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
      <div className="space-y-6" onClick={() => { setMenu(null); setStatusFor(null); }}>
        <PageHeader eyebrow="AI SDR" title="Outreach Agents" subtitle="Manage your automated outreach agents"
          actions={
            <>
              <span className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-base-100 px-3 py-2 text-sm">{running} / {agents?.length ?? 0} running</span>
              <Link href="/agents/new" className={primaryBtn}><RiAddLine size={16} /> Create an agent</Link>
            </>
          } />
        {agents === null ? <p className="text-sm text-base-content/40">Loading…</p> : agents.length === 0 ? (
          <Empty title="No agents yet">
            <p>Create an agent and it will find leads and run LinkedIn and email from one campaign.</p>
            <Link href="/agents/new" className={`${primaryBtn} mt-4`}><RiAddLine size={16} /> Create an agent</Link>
          </Empty>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {agents.map((a) => {
              const p = a.performance;
              const live = a.status === "active" || !!a.outreach_enabled;
              const sender = a.senders.linkedin?.name || a.senders.email?.from_email || "No sender";
              return (
                <Card key={a.id} className="!p-0">
                  <div className="flex items-start justify-between gap-3 px-5 pt-5">
                    <h2 className="min-w-0 truncate text-base font-semibold text-primary">{a.name}</h2>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <div className="relative">
                        <button className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${live ? "bg-success/15 text-success" : "bg-base-200 text-base-content/55"}`} onClick={() => { setStatusFor(statusFor === a.id ? null : a.id); setMenu(null); }}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />{live ? "Active" : a.status === "draft" ? "Draft" : "Paused"}
                        </button>
                        {statusFor === a.id && (
                          <div className="absolute right-0 z-20 mt-2 w-72 rounded-2xl border border-[var(--border-subtle)] bg-base-100 p-3 shadow-[var(--shadow-overlay)]">
                            <div className="mb-2 flex items-center justify-between">
                              <div><div className="text-[11px] uppercase tracking-wide text-base-content/40">Agent status</div><div className="font-medium">{live ? "Active" : "Paused"}</div></div>
                              <button className="inline-flex items-center gap-1 rounded-[8px] border border-[var(--border-subtle)] px-2 py-1 text-xs" onClick={() => patch(a.id, live ? { status: "paused", outreach_enabled: false } : { status: "active" }, live ? "Agent paused" : "Lead sourcing on")}><RiPauseLine />{live ? "Pause" : "Resume"}</button>
                            </div>
                            <Toggle label="Leads sourcing" hint="AI is finding new leads matching your criteria" on={a.status === "active"} onChange={() => patch(a.id, { status: a.status === "active" ? "paused" : "active" }, a.status === "active" ? "Lead sourcing paused" : "Lead sourcing on")} />
                            <Toggle label="Outreach" hint="AI is sending messages to contacted leads" on={!!a.outreach_enabled} onChange={() => patch(a.id, { outreach_enabled: !a.outreach_enabled }, a.outreach_enabled ? "Outreach paused" : "Outreach on")} />
                          </div>
                        )}
                      </div>
                      <div className="relative">
                        <button className="rounded-[8px] p-1.5 text-base-content/50 hover:bg-base-200" aria-label="Agent actions" onClick={() => { setMenu(menu === a.id ? null : a.id); setStatusFor(null); }}><RiMore2Fill size={18} /></button>
                        {menu === a.id && (
                          <div className="absolute right-0 z-20 mt-1 w-36 rounded-xl border border-[var(--border-subtle)] bg-base-100 py-1 shadow-[var(--shadow-overlay)]">
                            <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-base-200" onClick={() => duplicate(a.id)}><RiFileCopyLine /> Duplicate</button>
                            <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-base-200" onClick={() => remove(a)}><RiDeleteBinLine /> Delete</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 px-5 py-4">
                    <Metric label="Contacted" value={`${p.contacted}`} sub={`${p.found ? Math.round((p.contacted / p.found) * 100) : 0}% contacted`} extra={` / ${p.found}`} />
                    <Metric label="Accepted" value={pct(p.accepted, p.contacted)} sub="accept rate" />
                    <Metric label="Replied" value={p.replied ? pct(p.replied, p.contacted) : "—"} sub="reply rate" />
                    <Metric label="Interested" value={p.interested ? String(p.interested) : "—"} sub="interested leads" />
                  </div>
                  <div className="relative z-30 flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-base-100 px-5 py-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      {a.senders.linkedin && <RiLinkedinBoxFill className="shrink-0 text-[#0a66c2]" size={16} />}
                      {a.senders.email && <RiMailLine className="shrink-0 text-error" size={16} />}
                      <span className="truncate">{sender}</span>
                      <span className="hidden text-base-content/40 sm:inline">Created {timeAgo(a.created_at)}</span>
                    </div>
                    <Link href={`/agents/${a.id}`} className={primaryBtn + " !h-9"}>Open</Link>
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

function Metric({ label, value, sub, extra }: { label: string; value: string; sub: string; extra?: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-base-content/40">{label}</div>
      <div className="text-2xl font-semibold tabular-nums leading-tight">{value}{extra && <span className="text-sm font-normal text-base-content/35">{extra}</span>}</div>
      <div className="text-[11px] text-base-content/45">{sub}</div>
    </div>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: () => void }) {
  return (
    <div className="mt-2 flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] p-3">
      <div className="min-w-0 flex-1"><div className="text-sm font-medium">{label} <span className={`ml-1 text-[10px] font-semibold ${on ? "text-success" : "text-base-content/35"}`}>{on ? "ACTIVE" : "OFF"}</span></div><div className="text-xs text-base-content/50">{hint}</div></div>
      <input type="checkbox" className="toggle toggle-sm toggle-success" checked={on} onChange={onChange} aria-label={label} />
    </div>
  );
}
