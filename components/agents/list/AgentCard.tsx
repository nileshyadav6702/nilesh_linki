import Link from "next/link";
import { useState } from "react";
import { SiGmail } from "react-icons/si";
import { RiArrowRightSLine, RiDeleteBinLine, RiFileCopyLine, RiLinkedinFill, RiMailLine, RiMore2Fill } from "react-icons/ri";
import { FloatingMenu } from "@/components/agents/leads/Menu";
import { Avatar, Panel, primaryBtn, senderLine } from "@/components/agents/ui";
import AgentStatusMenu, { agentState } from "./AgentStatusMenu";

export interface AgentRow {
  id: string; name: string; status: string; outreach_enabled: number; created_at: string;
  performance: { found: number; contacted: number; accepted: number; replied: number; interested: number };
  senders: { linkedin: { id: string; name: string | null; email: string | null } | null; email: { id: string; from_email: string | null; from_name: string | null } | null };
  sender_pool: { linkedin: number; email: number };
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : null);
const created = (iso: string) => {
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

function Metric({ label, value, of, hint }: { label: string; value: string | null; of?: string; hint: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] uppercase tracking-[0.04em] text-base-content/60">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        {value === null
          ? <span className="mt-3 block h-[3px] w-6 rounded-full bg-base-content/80" aria-label="none yet" />
          : <span className="text-[28px] font-medium leading-none tabular-nums text-base-content">{value}</span>}
        {of && <span className="text-[15px] tabular-nums text-base-content/40">{of}</span>}
      </div>
      <div className="mt-2 truncate text-[14px] text-base-content/55">{hint}</div>
    </div>
  );
}

/** One agent: name + status switcher, four funnel metrics, senders and an Open action. */
export default function AgentCard({ a, onPatch, onDuplicate, onDelete }: {
  a: AgentRow;
  onPatch: (body: Record<string, unknown>, ok: string) => void;
  onDuplicate: () => void; onDelete: () => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const p = a.performance;
  const outreach = !!a.outreach_enabled;
  const state = agentState(a.status, outreach);
  const li = a.senders.linkedin;
  const mail = a.senders.email;
  const sender = senderLine(li?.name, mail?.from_email, a.sender_pool ?? { linkedin: 0, email: 0 });
  const gmail = !!mail?.from_email && /@(gmail|googlemail)\.com$/i.test(mail.from_email);
  const replied = pct(p.replied, p.contacted);

  return (
    <Panel className="flex flex-col transition-shadow hover:shadow-[0_1px_3px_rgba(20,20,19,0.08)]">
      <div className="flex items-center gap-3 px-8 pt-7">
        <Link href={`/agents/${a.id}`} title={a.name}
          className={`min-w-0 flex-1 truncate text-[17px] transition-colors hover:text-primary ${state === "paused" || state === "draft" ? "text-base-content" : "text-primary"}`}>
          {a.name}
        </Link>
        <AgentStatusMenu status={a.status} outreachOn={outreach}
          onSourcing={(on) => onPatch({ status: on ? "active" : "paused" }, on ? "Lead sourcing on" : "Lead sourcing paused")}
          onOutreach={(on) => onPatch({ outreach_enabled: on }, on ? "Outreach on" : "Outreach paused")}
          onAll={(on) => onPatch({ status: on ? "active" : "paused", outreach_enabled: on }, on ? "Agent resumed" : "Agent paused")} />
        <button type="button" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-base-content/55 hover:bg-base-200 hover:text-base-content"
          aria-label="Agent actions" aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => setMenu(menu ? null : e.currentTarget)}>
          <RiMore2Fill size={18} />
        </button>
        {menu && (
          <FloatingMenu anchor={menu} label="Agent actions" width={180} onClose={() => setMenu(null)} items={[
            { label: "Duplicate", icon: <RiFileCopyLine size={15} />, onSelect: () => { setMenu(null); onDuplicate(); } },
            { label: "Delete", icon: <RiDeleteBinLine size={15} />, danger: true, onSelect: () => { setMenu(null); onDelete(); } },
          ]} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-6 px-8 pb-7 pt-8 sm:grid-cols-4">
        <Metric label="Contacted" value={String(p.contacted)} of={`/ ${p.found}`} hint={`${pct(p.contacted, p.found) ?? "0%"} contacted`} />
        <Metric label="Accepted" value={pct(p.accepted, p.contacted)} hint="accept rate" />
        <Metric label="Replied" value={replied} hint={`${replied ?? "—"} reply rate`} />
        <Metric label="Interested" value={p.interested ? String(p.interested) : null} hint="interested leads" />
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-8 py-4">
        <div className="flex min-w-0 items-center gap-3 text-[15px] text-base-content/75">
          {(li || mail) && (
            <span className="inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3" aria-label={[li && "LinkedIn", mail && "Email"].filter(Boolean).join(" and ")}>
              {li && <RiLinkedinFill size={15} className="text-[#0a66c2]" />}
              {li && mail && <span className="h-3.5 w-px bg-[var(--border-subtle)]" />}
              {mail && (gmail ? <SiGmail size={13} className="text-[#ea4335]" /> : <RiMailLine size={15} className="text-error" />)}
            </span>
          )}
          {li || mail ? <Avatar name={sender} size={34} /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
          <span className="truncate">{sender}</span>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <span className="hidden text-[14px] text-base-content/45 sm:inline">Created on {created(a.created_at)}</span>
          <Link href={`/agents/${a.id}`} className={`${primaryBtn} !h-10 !px-4 shadow-[0_4px_12px_-4px_rgba(204,120,92,0.6)]`}>Open <RiArrowRightSLine size={16} /></Link>
        </div>
      </div>
    </Panel>
  );
}
