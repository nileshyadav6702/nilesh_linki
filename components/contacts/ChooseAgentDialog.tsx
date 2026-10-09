import Link from "next/link";
import { useEffect, useState } from "react";
import { RiAddLine, RiArrowRightSLine, RiLoader4Line, RiRobot2Line } from "react-icons/ri";
import { Modal } from "@/components/agents/sources/kit";
import { timeAgo } from "@/components/agents/ui";

/**
 * Contacts → Add leads. Every lead belongs to an agent (that's what scores it and runs outreach),
 * so adding leads means picking the agent, then its Lead sources open on the import options.
 */

interface AgentRow { id: string; name: string; status: string; created_at: string; counts?: { by_status?: Record<string, number> } }

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "border-success/30 bg-success/10 text-[#2f7a43]" },
  paused: { label: "Paused", cls: "border-[#e8a55a]/40 bg-[#e8a55a]/10 text-[#a0601d]" },
  draft: { label: "Draft", cls: "border-[var(--border-subtle)] bg-base-200 text-base-content/60" },
};

export default function ChooseAgentDialog({ onClose }: { onClose: () => void }) {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  useEffect(() => {
    fetch("/api/agents").then((r) => r.json()).then((a) => setAgents(Array.isArray(a) ? a : [])).catch(() => setAgents([]));
  }, []);

  return (
    <Modal labelId="choose-agent-title" title="Please choose an agent" subtitle="Select the agent you want to add leads to." wide={false} onClose={onClose}
      footer={<button type="button" onClick={onClose} className="h-10 rounded-[8px] px-4 text-[15px] font-medium hover:bg-base-200">Cancel</button>}>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto px-6 py-5">
        {agents === null && <div className="flex justify-center py-8"><RiLoader4Line size={24} className="animate-spin text-primary" /></div>}
        {agents?.map((a) => {
          const s = STATUS[a.status] ?? STATUS.draft;
          const leads = Object.values(a.counts?.by_status ?? {}).reduce((x, y) => x + y, 0);
          return (
            <Link key={a.id} href={`/agents/${a.id}?tab=Sources&add=1`} onClick={onClose}
              className="group flex items-center gap-4 rounded-[12px] border border-[var(--border-subtle)] px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-primary/[0.04]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary"><RiRobot2Line size={22} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px]">{a.name}</span>
                <span className="mt-1 flex items-center gap-2 text-[14px] text-base-content/60">
                  <span className={`rounded-[5px] border px-1.5 text-[12px] ${s.cls}`}>{s.label}</span>
                  {leads.toLocaleString()} lead{leads === 1 ? "" : "s"} · Created {timeAgo(a.created_at)}
                </span>
              </span>
              <RiArrowRightSLine size={22} className="shrink-0 text-base-content/40 transition-transform group-hover:translate-x-0.5" />
            </Link>
          );
        })}
        {agents && (
          <Link href="/agents/new" onClick={onClose}
            className="flex items-center gap-4 rounded-[12px] border border-dashed border-[var(--border-strong)] px-4 py-3.5 text-[15px] text-base-content/75 transition-colors hover:border-primary/40 hover:text-primary">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-base-200"><RiAddLine size={22} /></span>
            {agents.length ? "Create a new agent instead" : "You have no agents yet. Create one to add leads"}
          </Link>
        )}
      </div>
    </Modal>
  );
}
