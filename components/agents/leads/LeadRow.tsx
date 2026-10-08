import { useState } from "react";
import { RiCloseLine, RiDeleteBin6Line, RiLinkedinBoxFill, RiMore2Fill } from "react-icons/ri";
import { Avatar, Flames, timeAgo } from "@/components/agents/ui";
import { ApprovalCell, EmailCell, OutreachCell, PhoneCell, SignalCell } from "./cells";
import { FloatingMenu } from "./Menu";
import type { LeadRowData } from "./types";

/** Cell classes. Every cell paints a solid background so sticky (pinned) cells cover what scrolls under them. */
export const cellBase = "border-b border-[var(--border-subtle)] px-3 py-3.5 align-middle";
export const stickyCheck = "sticky left-0 z-10";
export const stickyContact = "sticky left-12 z-10";
export const pinnedEdge = "border-r border-r-[var(--border-subtle)] shadow-[6px_0_8px_-6px_rgba(20,20,19,0.14)]";

export interface RowProps {
  lead: LeadRowData; selected: boolean; pinned: boolean; scrolled: boolean; showAgent: boolean;
  onToggle: () => void; onOpen: () => void; onReject: () => void; onRemove: () => void; onDelete: () => void;
}

export default function LeadRow({ lead: r, selected, pinned, scrolled, showAgent, onToggle, onOpen, onReject, onRemove, onDelete }: RowProps) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const bg = selected ? "bg-base-200" : "bg-base-100 group-hover:bg-base-200";
  const td = `${cellBase} ${bg} transition-colors`;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <tr className="group cursor-pointer" onClick={onOpen}>
      <td className={`${td} w-12 min-w-12 max-w-12 pl-4 pr-2 ${pinned ? stickyCheck : ""}`} onClick={stop}>
        <input type="checkbox" className="checkbox checkbox-xs" aria-label={`Select ${r.full_name ?? "lead"}`} checked={selected} onChange={onToggle} />
      </td>
      <td className={`${td} w-[300px] min-w-[280px] max-w-[300px] ${pinned ? `${stickyContact} ${scrolled ? pinnedEdge : ""}` : ""}`}>
        <div className="flex items-center gap-3">
          <Avatar name={r.full_name} src={r.profile_image_url} size={40} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="truncate text-left font-medium text-primary hover:underline">{r.full_name ?? "Unknown"}</button>
              {r.linkedin_url && <a href={r.linkedin_url} target="_blank" rel="noreferrer" onClick={stop} aria-label="LinkedIn profile" className="shrink-0 text-[#0a66c2] hover:opacity-80"><RiLinkedinBoxFill size={16} /></a>}
            </div>
            <div className="truncate text-[13px] text-base-content/60">{r.title ?? r.headline}</div>
            {r.company && <div className="truncate text-xs text-base-content/40">@ {r.company}</div>}
          </div>
        </div>
      </td>
      <td className={`${td} w-[320px] min-w-[260px] max-w-[340px]`}><SignalCell lead={r} /></td>
      <td className={`${td} w-[96px]`} title={r.fit_reason ?? undefined}><Flames score={r.lead_score ?? r.intent_score} /></td>
      <td className={`${td} w-[230px] max-w-[240px]`}><EmailCell lead={r} /></td>
      <td className={`${td} w-[150px] max-w-[170px]`}><PhoneCell lead={r} /></td>
      <td className={`${td} min-w-[320px]`}><OutreachCell outreach={r.outreach} /></td>
      <td className={`${td} min-w-[210px]`} onClick={stop}><ApprovalCell lead={r} onReject={onReject} onReview={onOpen} /></td>
      {showAgent && <td className={`${td} max-w-[160px] truncate text-xs text-base-content/50`}>{r.agent_name}</td>}
      <td className={`${td} whitespace-nowrap pr-4 text-right`} onClick={stop}>
        <span className="mr-1 text-[11px] text-base-content/35">{timeAgo(r.created_at)}</span>
        <button type="button" aria-label={`Actions for ${r.full_name ?? "lead"}`} aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => setMenu(menu ? null : e.currentTarget)}
          className="rounded-[6px] p-1.5 text-base-content/45 hover:bg-base-300 hover:text-base-content"><RiMore2Fill size={16} /></button>
        {menu && (
          <FloatingMenu anchor={menu} label="Lead actions" onClose={() => setMenu(null)} items={[
            { label: "Remove from List & Campaign", icon: <RiCloseLine size={16} />, onSelect: onRemove },
            { label: "Permanently Delete", icon: <RiDeleteBin6Line size={16} />, onSelect: onDelete, danger: true },
          ]} />
        )}
      </td>
    </tr>
  );
}
