import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { RiArchiveDrawerLine, RiArrowDownSLine, RiCheckLine, RiGoogleFill, RiLinkedinBoxFill, RiMailLine, RiMicrosoftFill, RiSettings3Line } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import type { AccountsInfo } from "@/components/inbox/kit";

/** "All accounts ▾": pick every account, one channel, or one LinkedIn account / mailbox. */

function Row({ on, icon, label, count, onClick, sub }: { on: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void; sub?: boolean }) {
  return (
    <button type="button" role="option" aria-selected={on} onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors ${on ? "bg-primary/10" : "hover:bg-base-200"} ${sub ? "pl-4" : ""}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center">{icon}</span>
      <span className={`min-w-0 flex-1 truncate text-[16px] ${on ? "text-primary" : "text-base-content"}`}>{label}</span>
      {count !== undefined && <span className="text-[15px] tabular-nums text-base-content/55">{count}</span>}
      {on && <RiCheckLine size={18} className="shrink-0 text-primary" />}
    </button>
  );
}

export function scopeLabel(scope: string, info: AccountsInfo | null): { label: string; icon: ReactNode } {
  if (scope === "linkedin") return { label: "All LinkedIn", icon: <RiLinkedinBoxFill size={16} className="text-[#0a66c2]" /> };
  if (scope === "email") return { label: "All Email", icon: <RiMailLine size={16} className="text-[#e2603f]" /> };
  const [ch, id] = scope.split(":");
  if (ch === "linkedin") return { label: info?.linkedin.accounts.find((a) => a.id === id)?.name ?? "LinkedIn", icon: <RiLinkedinBoxFill size={16} className="text-[#0a66c2]" /> };
  if (ch === "email") return { label: info?.email.accounts.find((a) => a.id === id)?.name ?? "Mailbox", icon: <RiMailLine size={16} className="text-[#e2603f]" /> };
  return { label: "All accounts", icon: <RiArchiveDrawerLine size={16} /> };
}

export default function AccountSwitcher({ scope, setScope, info }: { scope: string; setScope: (s: string) => void; info: AccountsInfo | null }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  const pick = (s: string) => { setScope(s); setOpen(false); };
  const cur = scopeLabel(scope, info);
  const heading = (t: string) => <div className="px-4 pb-1 pt-3 text-[13px] font-medium uppercase tracking-[0.08em] text-base-content/50">{t}</div>;
  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="listbox"
        className={`inline-flex h-10 max-w-[260px] items-center gap-2 rounded-full border px-4 text-[15px] transition-colors ${open ? "border-primary/50 bg-primary/5 text-primary" : "border-[var(--border-subtle)] hover:bg-base-200"}`}>
        {cur.icon}<span className="truncate">{cur.label}</span><RiArrowDownSLine size={18} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && info && (
        <div role="listbox" aria-label="Accounts" className="pop-in absolute left-0 top-full z-40 mt-2 max-h-[70vh] w-[360px] overflow-y-auto rounded-[14px] border border-[var(--border-subtle)] bg-base-100 p-1.5 shadow-[var(--shadow-overlay)]">
          <Row on={scope === "all"} icon={<RiArchiveDrawerLine size={20} className="text-base-content/70" />} label="All accounts" count={info.all} onClick={() => pick("all")} />
          <div className="my-1 border-t border-[var(--border-subtle)]" />
          {heading("LinkedIn")}
          {info.linkedin.accounts.length ? <>
            <Row on={scope === "linkedin"} icon={<RiLinkedinBoxFill size={22} className="text-[#0a66c2]" />} label="All LinkedIn" count={info.linkedin.total} onClick={() => pick("linkedin")} />
            {info.linkedin.accounts.map((a) => (
              <Row key={a.id} sub on={scope === `linkedin:${a.id}`} icon={<span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e6f0fa] text-[13px] font-medium text-[#0a66c2]">{a.name.charAt(0).toUpperCase()}</span>}
                label={a.name} count={a.count} onClick={() => pick(`linkedin:${a.id}`)} />
            ))}
          </> : <div className="px-4 py-2 text-[14px] text-base-content/50">No LinkedIn account connected</div>}
          <div className="my-1 border-t border-[var(--border-subtle)]" />
          {heading("Email")}
          {info.email.accounts.length ? <>
            <Row on={scope === "email"} icon={<RiMailLine size={22} className="text-[#e2603f]" />} label="All Email" count={info.email.total} onClick={() => pick("email")} />
            {info.email.accounts.map((a) => (
              <Row key={a.id} sub on={scope === `email:${a.id}`} label={a.name} count={a.count} onClick={() => pick(`email:${a.id}`)}
                icon={/gmail/.test(a.provider) ? <RiGoogleFill size={20} className="text-[#ea4335]" /> : a.provider === "microsoft" ? <RiMicrosoftFill size={20} className="text-[#0078d4]" /> : <RiMailLine size={20} className="text-base-content/60" />} />
            ))}
          </> : <div className="px-4 py-2 text-[14px] text-base-content/50">No mailbox connected</div>}
          <div className="my-1 border-t border-[var(--border-subtle)]" />
          <Link href="/settings" className="flex items-center gap-3 rounded-[10px] px-4 py-2.5 text-[15px] text-base-content/70 hover:bg-base-200"><RiSettings3Line size={18} /> Manage accounts</Link>
        </div>
      )}
    </div>
  );
}
