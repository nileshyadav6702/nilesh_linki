import { useRef, useState, type ReactNode } from "react";
import { RiCalendarLine, RiCloseLine, RiFilter3Line } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { SearchSelect } from "@/components/agents/sources/kit";
import { SIGNAL_LABEL } from "@/components/agents/ui";
import { EMPTY_FILTERS, type ContactFilters } from "@/components/contacts/useContacts";

/** "Add more filters" panel for the Contacts table. Every change applies at once. */

const Flames = ({ n }: { n: number }) => <span className="ml-1 inline-flex gap-0.5" aria-hidden="true">{Array.from({ length: n }, (_, i) => <span key={i}>🔥</span>)}</span>;

const SCORES = [
  { value: "", label: "All Scores" }, { value: "1", label: "First Signs of Interest", pill: <Flames n={1} /> },
  { value: "2", label: "Actively Exploring", pill: <Flames n={2} /> }, { value: "3", label: "Ready to Engage", pill: <Flames n={3} /> },
];
const EMAIL = [{ value: "", label: "All Contacts" }, { value: "found", label: "Email Found" }, { value: "not_found", label: "Email Not Found" }, { value: "not_enriched", label: "Email Not Enriched Yet" }, { value: "unsubscribed", label: "Unsubscribed" }];
const PHONE = [{ value: "", label: "All Contacts" }, { value: "found", label: "Phone Found" }, { value: "not_found", label: "Phone Not Found" }, { value: "not_enriched", label: "Phone Not Enriched Yet" }];
const INTERESTED = [{ value: "", label: "All Contacts" }, { value: "1", label: "Interested only" }];
const APPROVAL = [{ value: "", label: "All" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "pending", label: "To review" }];
const CAMPAIGN = [
  { value: "", label: "All Campaign Statuses" }, { value: "not_contacted", label: "Not contacted" }, { value: "invitation_sent", label: "Invitation sent" },
  { value: "invitation_accepted", label: "Invitation accepted" }, { value: "invitation_withdrawn", label: "Invitation withdrawn" },
  { value: "message_sent", label: "Message sent" }, { value: "inmail_sent", label: "InMail sent" }, { value: "email_sent", label: "Email sent" }, { value: "replied", label: "Message replied" },
];
const SORT = [{ value: "newest", label: "Newest first" }, { value: "score_desc", label: "Score: High to Low" }, { value: "score_asc", label: "Score: Low to High" }];

const Label = ({ children }: { children: ReactNode }) => <div className="mb-1.5 text-[15px] text-base-content/80">{children}</div>;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const fmt = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  const presets: Array<[string, () => [string, string]]> = [
    ["Last 7 days", () => [daysAgo(7), iso(new Date())]], ["Last 30 days", () => [daysAgo(30), iso(new Date())]],
    ["Last 90 days", () => [daysAgo(90), iso(new Date())]], ["This month", () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(d)]; }],
  ];
  const label = from || to ? `${from ? fmt(from) : "…"} – ${to ? fmt(to) : "today"}` : null;
  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => { setA(from); setB(to); setOpen(!open); }} aria-expanded={open}
        className={`flex h-11 w-full items-center gap-2.5 rounded-[8px] border bg-base-100 px-3 text-left text-[15px] ${open ? "border-[var(--border-focus)]" : "border-[var(--border-strong)] hover:bg-base-200/50"}`}>
        <RiCalendarLine size={18} className="text-base-content/55" />
        <span className={label ? "text-base-content" : "text-base-content/55"}>{label ?? "Select date range..."}</span>
        {label && <span role="button" tabIndex={0} aria-label="Clear date range" onClick={(e) => { e.stopPropagation(); onChange("", ""); }} className="ml-auto rounded p-0.5 text-base-content/45 hover:bg-base-200"><RiCloseLine size={16} /></span>}
      </button>
      {open && (
        <div className="wizard-rise absolute left-0 top-full z-50 mt-2 w-[400px] rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-5 shadow-[var(--shadow-overlay)]">
          <div className="flex items-center justify-between"><div className="text-[17px] font-medium">Select Date Range</div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-base-content/50 hover:text-base-content"><RiCloseLine size={20} /></button></div>
          <div className="mt-4 text-[14px] text-base-content/65">Quick Presets</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {presets.map(([name, range]) => {
              const [x, y] = range();
              const on = a === x && b === y;
              return <button key={name} type="button" onClick={() => { setA(x); setB(y); }} className={`h-11 rounded-[8px] border px-3 text-left text-[15px] transition-colors ${on ? "border-primary/50 bg-primary/10 text-primary" : "border-[var(--border-subtle)] hover:bg-base-200"}`}>{name}</button>;
            })}
          </div>
          <div className="mt-4 text-[14px] text-base-content/65">Custom Range</div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label className="text-[13px] text-base-content/60">From<input type="date" value={a} max={b || undefined} onChange={(e) => setA(e.target.value)} className="mt-1 h-10 w-full rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-2 text-[14px] text-base-content" /></label>
            <label className="text-[13px] text-base-content/60">To<input type="date" value={b} min={a || undefined} onChange={(e) => setB(e.target.value)} className="mt-1 h-10 w-full rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-2 text-[14px] text-base-content" /></label>
          </div>
          <div className="mt-5 flex items-center justify-between">
            <button type="button" onClick={() => { setA(""); setB(""); }} className="text-[15px] underline underline-offset-2">Clear</button>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-[8px] px-3 text-[15px] hover:bg-base-200">Cancel</button>
              <button type="button" disabled={a === from && b === to} onClick={() => { onChange(a, b); setOpen(false); }} className="h-10 rounded-[8px] bg-primary px-4 text-[15px] font-medium text-primary-content disabled:opacity-50">Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FiltersPanel({ filters, patch, clear, onClose, agents, lists, signals, lockAgent = false }: {
  filters: ContactFilters; patch: (p: Partial<ContactFilters>) => void; clear: () => void; onClose: () => void;
  agents: Array<{ id: string; name: string }>; lists: Array<{ id: string; name: string; target_count: number }>; signals: Array<{ type: string; count: number }>;
  /** The agent is fixed (an agent's Leads tab): hide the agent picker. */
  lockAgent?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(true, [wrap], onClose);
  const sel = (label: string, value: string, options: Array<{ value: string; label: string; pill?: ReactNode }>, onChange: (v: string) => void, searchable = false) => (
    <div><Label>{label}</Label><SearchSelect label={label} value={value} options={options} placeholder={options[0]?.label ?? "All"} searchable={searchable} onChange={onChange} /></div>
  );
  return (
    <div ref={wrap} role="dialog" aria-label="Contact filters" className="wizard-rise absolute left-0 top-full z-40 mt-2 max-h-[calc(100vh-260px)] w-[min(880px,calc(100vw-2rem))] overflow-y-auto rounded-[14px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
      <button type="button" onClick={onClose} aria-label="Close filters" className="absolute right-4 top-4 z-10 text-base-content/50 hover:text-base-content"><RiCloseLine size={22} /></button>
      <div className="grid gap-x-5 gap-y-4 px-6 pb-5 pt-6 sm:grid-cols-2">
        {!lockAgent && sel("AI Agent", filters.agent, [{ value: "", label: "All Agents" }, ...agents.map((a) => ({ value: a.id, label: a.name }))], (v) => patch({ agent: v }), agents.length > 6)}
        {sel("List", filters.list, [{ value: "", label: "All Lists" }, { value: "none", label: "Contacts without any list" }, ...lists.map((l) => ({ value: l.id, label: `${l.name} (${l.target_count})` }))], (v) => patch({ list: v }), true)}
        {sel("AI Score", filters.band, SCORES, (v) => patch({ band: v }))}
        {sel("Email Enrichment", filters.email, EMAIL, (v) => patch({ email: v }))}
        {sel("Phone Enrichment", filters.phone, PHONE, (v) => patch({ phone: v }))}
        {sel("Interested", filters.interested ? "1" : "", INTERESTED, (v) => patch({ interested: v === "1" }))}
        <label className="flex cursor-pointer items-center gap-3 self-end pb-2.5">
          <input type="checkbox" className="checkbox checkbox-sm rounded-[4px]" checked={filters.replied} onChange={(e) => patch({ replied: e.target.checked })} />
          <span className="text-[16px]">Contacts that replied</span>
        </label>
        {sel("Signal", filters.signal, [{ value: "", label: "All Signals" }, ...signals.map((s) => ({ value: s.type, label: `${SIGNAL_LABEL[s.type] ?? s.type.replace(/_/g, " ")} (${s.count})` }))], (v) => patch({ signal: v }), true)}
        {sel("Approval", filters.approval, APPROVAL, (v) => patch({ approval: v }))}
        {sel("Campaign status", filters.step, CAMPAIGN, (v) => patch({ step: v }))}
        <div><Label>Date Range</Label><DateRange from={filters.from} to={filters.to} onChange={(from, to) => patch({ from, to })} /></div>
      </div>
      <div className="border-t border-[var(--border-subtle)] px-6 py-4">
        <div className="mb-1.5 flex items-center gap-2 text-[15px] text-base-content/80">Sort Order <RiFilter3Line size={16} className="text-base-content/50" /></div>
        <SearchSelect label="Sort order" value={filters.sort} options={SORT} placeholder="Newest first" searchable={false} onChange={(v) => patch({ sort: v || EMPTY_FILTERS.sort })} />
      </div>
      <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-6 py-4">
        <button type="button" onClick={clear} className="text-[16px] underline underline-offset-2 hover:text-base-content/70">Clear All</button>
        <button type="button" onClick={onClose} className="text-[16px] text-base-content/80 hover:text-base-content">Close</button>
      </div>
    </div>
  );
}
