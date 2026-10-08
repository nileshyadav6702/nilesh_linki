import { useRef, useState, type ReactNode } from "react";
import { RiArrowDownSLine, RiPauseLine, RiPlayLine, RiSearchLine, RiSendPlaneLine } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { Toggle } from "@/components/agents/ui";

export type AgentState = "running" | "sourcing" | "outreach" | "paused" | "draft";

export function agentState(status: string, outreachOn: boolean): AgentState {
  if (status === "draft") return "draft";
  const sourcing = status === "active";
  if (sourcing && outreachOn) return "running";
  if (sourcing) return "sourcing";
  if (outreachOn) return "outreach";
  return "paused";
}

const LABEL: Record<AgentState, string> = { running: "Running", sourcing: "Leads sourcing only", outreach: "Outreach only", paused: "Paused", draft: "Draft" };
const PILL: Record<AgentState, string> = {
  running: "border-success/30 bg-success/10 text-success",
  sourcing: "border-primary/30 bg-primary/10 text-primary",
  outreach: "border-primary/30 bg-primary/10 text-primary",
  paused: "border-[var(--border-subtle)] bg-base-200 text-base-content/60",
  draft: "border-[var(--border-subtle)] bg-base-200 text-base-content/60",
};

function Row({ icon, title, on, body, onToggle }: { icon: ReactNode; title: string; on: boolean; body: string; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-4 rounded-[12px] border border-[var(--border-subtle)] p-4">
      <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] ${on ? "bg-primary/15 text-primary" : "bg-base-200 text-base-content/35"}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-medium text-base-content">{title}</span>
          <span className={`rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] ${on ? "bg-success/10 text-success" : "bg-base-200 text-base-content/50"}`}>{on ? "Active" : "Paused"}</span>
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-base-content/50">{body}</p>
      </div>
      <Toggle on={on} onChange={onToggle} label={`${title} ${on ? "on" : "off"}`} />
    </div>
  );
}

/** Status pill that opens the agent's two switches (lead sourcing, outreach) plus a pause/resume-all action. */
export default function AgentStatusMenu({ status, outreachOn, onSourcing, onOutreach, onAll }: {
  status: string; outreachOn: boolean;
  onSourcing: (on: boolean) => void; onOutreach: (on: boolean) => void; onAll: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  const state = agentState(status, outreachOn);
  const sourcing = status === "active";
  const anyOn = sourcing || outreachOn;

  return (
    <div ref={wrap} className="relative shrink-0">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-8 items-center gap-1.5 rounded-[6px] border px-2.5 text-[13px] transition-colors ${PILL[state]}`}>
        {state !== "paused" && state !== "draft" && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
        {LABEL[state]}
        <RiArrowDownSLine size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="dialog" aria-label="Agent status" className="absolute left-0 top-full z-40 mt-2 w-[min(540px,calc(100vw-32px))] rounded-[14px] border border-[var(--border-subtle)] bg-base-100 p-5 shadow-[var(--shadow-overlay)]">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-base-content/45">Agent status</div>
              <div className="mt-0.5 text-[17px] text-base-content">{LABEL[state]}</div>
            </div>
            <button type="button" onClick={() => onAll(!anyOn)}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-base-content/60 px-4 text-sm text-base-content hover:bg-base-200">
              {anyOn ? <><RiPauseLine size={15} /> Pause</> : <><RiPlayLine size={15} /> Resume</>}
            </button>
          </div>
          <div className="space-y-3">
            <Row icon={<RiSearchLine size={22} />} title="Leads sourcing" on={sourcing} body="AI is finding new leads matching your criteria" onToggle={() => onSourcing(!sourcing)} />
            <Row icon={<RiSendPlaneLine size={22} />} title="Outreach" on={outreachOn} body="AI is sending messages to contacted leads" onToggle={() => onOutreach(!outreachOn)} />
          </div>
        </div>
      )}
    </div>
  );
}
