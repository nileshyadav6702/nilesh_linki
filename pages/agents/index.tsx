import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { RiAddLine, RiBroadcastLine, RiRobot2Line, RiTeamLine } from "react-icons/ri";
import AgentCard, { type AgentRow } from "@/components/agents/list/AgentCard";
import HowItWorks from "@/components/agents/list/HowItWorks";
import { Empty, IconTile, primaryBtn } from "@/components/agents/ui";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const load = () => fetch("/api/agents").then((r) => r.json()).then(setAgents).catch(() => setAgents([]));
  useEffect(() => { load(); }, []);

  async function patch(id: string, body: Record<string, unknown>, ok: string) {
    const r = await fetch(`/api/agents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return toast.error((await r.json()).error ?? "Could not update agent");
    toast.success(ok);
    load();
  }

  async function duplicate(id: string) {
    const r = await fetch(`/api/agents/${id}/duplicate`, { method: "POST" });
    const data = await r.json();
    if (!r.ok) return toast.error(data.error ?? "Could not duplicate");
    toast.success("Agent duplicated");
    router.push(`/agents/${data.id}`);
  }

  async function remove(a: AgentRow) {
    if (!confirm(`Delete ${a.name}? Its leads stay; this agent stops finding and sending.`)) return;
    await fetch(`/api/agents/${a.id}`, { method: "DELETE" });
    toast.success("Agent deleted");
    load();
  }

  // "Running" = reaching out right now; sourcing-only agents are counted as not running.
  const running = agents?.filter((a) => a.status === "active" && a.outreach_enabled).length ?? 0;

  return (
    <>
      <Head><title>Outreach Agents — Kairo</title></Head>
      <div className="space-y-7">
        <div className="-mx-4 -mt-6 flex flex-col justify-between gap-4 border-b border-[var(--border-subtle)] px-4 pb-6 pt-6 sm:flex-row sm:items-center md:-mx-10 md:-mt-9 md:px-10 md:pt-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <RiBroadcastLine size={24} className="text-primary" aria-hidden />
              <h1 className="text-[24px] font-semibold leading-tight text-base-content">Outreach Agents</h1>
              <HowItWorks />
            </div>
            <p className="mt-1.5 pl-[36px] text-[16px] text-base-content/65">Manage your automated outreach agents</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!!agents?.length && (
              <span className="inline-flex h-11 items-center gap-3 rounded-[8px] border border-[var(--border-subtle)] bg-base-200/60 px-4 text-[18px] text-base-content">
                <RiTeamLine size={18} className="text-primary" aria-hidden />
                <span className="tabular-nums">{running} / {agents.length}</span> running agents
              </span>
            )}
            <Link href="/agents/new" className={`${primaryBtn} !h-11 shadow-[0_4px_12px_-4px_rgba(204,120,92,0.6)]`}><RiAddLine size={17} /> Create an agent</Link>
          </div>
        </div>

        {agents === null ? <p className="text-[15px] text-base-content/40">Loading…</p> : agents.length === 0 ? (
          <Empty title="No agents yet">
            <IconTile icon={<RiRobot2Line size={24} />} size={48} className="mx-auto mb-3" />
            <p>Create an agent and it will find leads and run LinkedIn and email from one sequence.</p>
            <Link href="/onboarding" className={`${primaryBtn} mt-4`}><RiAddLine size={16} /> Create an agent</Link>
          </Empty>
        ) : (
          <div className="grid items-stretch gap-6 xl:grid-cols-2">
            {agents.map((a, i) => (
              <AgentCard key={a.id} a={a} index={i}
                onPatch={(body, ok) => patch(a.id, body, ok)}
                onDuplicate={() => duplicate(a.id)}
                onDelete={() => remove(a)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
