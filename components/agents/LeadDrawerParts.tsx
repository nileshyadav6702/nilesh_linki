import { useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import {
  RiArrowDownSLine, RiBriefcase4Line, RiChat3Line, RiCodeSSlashLine, RiExternalLinkLine, RiFileCopyLine, RiFileDownloadLine, RiFileList3Line,
  RiFlashlightLine, RiGlobalLine, RiGroupLine, RiHeartPulseLine, RiLineChartLine, RiLinkedinBoxFill, RiRadioButtonLine, RiUpload2Line,
  RiUserAddLine, RiUserStarLine,
} from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { signalLine } from "@/components/agents/signal-line";

/** Pieces of the lead side panel: sections, signal timeline, link icons with tooltips, activity, export menu. */

export const LINK = "#5b4fd6";

/** A panel section. `collapsible` adds the chevron; `tint` gives the soft background (activity log). */
export function Section({ icon, title, right, sub, open = true, onToggle, tint, small, children }: {
  icon: ReactNode; title: ReactNode; right?: ReactNode; sub?: ReactNode; open?: boolean; onToggle?: () => void; tint?: boolean; small?: boolean; children?: ReactNode;
}) {
  const head = (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span className="shrink-0 text-base-content/80">{icon}</span>
      <span className={`truncate ${small ? "text-[16px] text-base-content/80" : "text-[18px] font-semibold text-base-content"}`}>{title}</span>
    </span>
  );
  return (
    <section className={`border-b border-[var(--border-subtle)] px-8 py-6 ${tint ? "bg-primary/[0.05]" : ""}`}>
      <div className="flex items-center gap-3">
        {onToggle ? <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 text-left">{head}</button> : head}
        {right && <span className="flex shrink-0 items-center gap-3">{right}</span>}
        {onToggle && (
          <button type="button" onClick={onToggle} aria-label={open ? "Collapse" : "Expand"} className="shrink-0 text-base-content/60 hover:text-base-content">
            <RiArrowDownSLine size={24} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {sub && <div className="mt-1.5 pl-8">{sub}</div>}
      {open && children && <div className="wizard-rise mt-5">{children}</div>}
    </section>
  );
}

/** Icon link with a small card on hover (e.g. the company's website URL). */
export function TipLink({ href, tip, label, children }: { href: string; tip: string; label: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      <a href={href} target="_blank" rel="noreferrer" aria-label={label} className="flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors hover:bg-base-200">{children}</a>
      <span role="tooltip" className="pointer-events-none invisible absolute bottom-full right-0 z-20 mb-2 whitespace-nowrap rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3.5 py-2 text-[15px] text-base-content opacity-0 shadow-[var(--shadow-overlay)] transition-opacity duration-150 group-hover/tip:visible group-hover/tip:opacity-100">{tip}</span>
    </span>
  );
}

export const CrunchbaseIcon = () => (
  <span className="flex h-[19px] w-[19px] items-center justify-center rounded-[5px] bg-[#4f46e5] text-[11px] font-bold leading-none text-white">cb</span>
);

const SIGNAL_TILE: Record<string, { icon: ReactNode; cls: string }> = {
  hiring: { icon: <RiUserAddLine size={18} />, cls: "bg-[#f1ebff] text-[#7c3aed]" },
  product_intent: { icon: <RiHeartPulseLine size={18} />, cls: "bg-[#ffe8ec] text-[#e11d48]" },
  funding: { icon: <RiLineChartLine size={18} />, cls: "bg-[#e6f7ee] text-[#16a34a]" },
  job_change: { icon: <RiBriefcase4Line size={18} />, cls: "bg-[#fff2dc] text-[#c2700a]" },
  competitor_engagement: { icon: <RiFlashlightLine size={18} />, cls: "bg-primary/10 text-primary" },
  keyword_engagement: { icon: <RiFlashlightLine size={18} />, cls: "bg-primary/10 text-primary" },
  own_content_engagement: { icon: <RiChat3Line size={18} />, cls: "bg-primary/10 text-primary" },
  influencer_engagement: { icon: <RiUserStarLine size={18} />, cls: "bg-[#fff2dc] text-[#c2700a]" },
  website_visit: { icon: <RiGlobalLine size={18} />, cls: "bg-[#dff5ef] text-[#17876b]" },
  lookalike: { icon: <RiGroupLine size={18} />, cls: "bg-base-200 text-base-content/70" },
  existing_list: { icon: <RiFileList3Line size={18} />, cls: "bg-base-200 text-base-content/70" },
  linkedin_import: { icon: <RiLinkedinBoxFill size={18} />, cls: "bg-[#e7f0fb] text-[#0a66c2]" },
  technology: { icon: <RiCodeSSlashLine size={18} />, cls: "bg-base-200 text-base-content/70" },
};

const parse = (iso: string | null | undefined) => (iso ? new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`) : null);
const shortDate = (iso: string | null | undefined) => { const d = parse(iso); return d && !Number.isNaN(d.getTime()) ? format(d, "MMM d") : ""; };

export interface SignalRow { id: string; type: string; title: string; snippet: string | null; source_url: string | null; occurred_at: string; metadata_json?: string | null }

export function SignalList({ signals }: { signals: SignalRow[] }) {
  if (!signals.length) return <p className="text-[15px] text-base-content/50">No signals recorded yet.</p>;
  return (
    <ol>
      {signals.map((s, i) => {
        const t = SIGNAL_TILE[s.type] ?? { icon: <RiHeartPulseLine size={18} />, cls: "bg-[#ffe8ec] text-[#e11d48]" };
        const line = signalLine(s);
        const last = i === signals.length - 1;
        return (
          <li key={s.id} className="flex items-stretch gap-4">
            <div className="flex w-9 shrink-0 flex-col items-center">
              <span className={`flex h-9 w-9 items-center justify-center rounded-[8px] ${t.cls}`}>{t.icon}</span>
              {!last && <span className="my-1.5 w-px flex-1 bg-[var(--border-strong)]" />}
            </div>
            <div className={`min-w-0 flex-1 pt-1.5 ${last ? "" : "pb-6"}`}>
              <div className="flex items-start justify-between gap-3">
                <span className="text-[17px] leading-snug text-base-content">
                  {line.lead}
                  {line.link && (line.href
                    ? <a href={line.href} target="_blank" rel="noreferrer" style={{ color: LINK }} className="hover:underline" title={s.snippet ?? undefined}>{line.link}</a>
                    : <span style={{ color: LINK }}>{line.link}</span>)}
                  {line.tail}
                </span>
                <span className="shrink-0 pt-0.5 text-[14px] text-base-content/45">{shortDate(s.occurred_at)}</span>
              </div>
              {line.sub && <p className="mt-1 truncate text-[14px] text-base-content/55">{line.sub}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Label on the left, value on the right (Basic information). */
export function Rows({ rows }: { rows: Array<[string, ReactNode]> }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!shown.length) return <p className="text-[15px] text-base-content/50">Nothing yet — this fills in when the profile is enriched.</p>;
  return (
    <dl className="space-y-4">
      {shown.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-6 text-[16px]">
          <dt className="shrink-0 text-base-content/55">{k}</dt><dd className="min-w-0 text-right text-base-content">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ActivityLog({ items }: { items: Array<{ at: string; kind: string; text: string }> }) {
  if (!items.length) return <p className="text-[14px] text-base-content/50">No activity yet.</p>;
  return (
    <ol className="space-y-4">
      {items.map((a, i) => {
        const d = parse(a.at);
        return (
          <li key={i} className="flex items-start gap-3">
            <RiRadioButtonLine size={18} className={`mt-0.5 shrink-0 ${a.kind === "outreach" ? "text-success" : "text-base-content/50"}`} />
            <div className="min-w-0">
              <p className="text-[15px] leading-snug text-base-content/80">{a.text}</p>
              {d && !Number.isNaN(d.getTime()) && <p className="mt-0.5 text-[14.5px] text-base-content/45">{format(d, "MMM dd, yyyy 'at' HH:mm")}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Footer "Export" menu (opens upward): CSV of this lead, copy details, open the full profile. */
export function ExportMenu({ onCsv, onCopy, profileHref }: { onCsv: () => void; onCopy: () => void; profileHref: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  const item = "flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left text-[15px] hover:bg-base-200";
  return (
    <div ref={wrap} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="inline-flex h-12 items-center gap-2.5 rounded-[10px] border border-[var(--border-strong)] bg-base-100 px-5 text-[17px] hover:bg-base-200/60">
        <RiUpload2Line size={19} />Export<RiArrowDownSLine size={20} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="pop-in absolute bottom-full right-0 z-30 mb-2 w-[230px] rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1 shadow-[var(--shadow-overlay)]">
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onCsv(); }}><RiFileDownloadLine size={18} />Download CSV</button>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onCopy(); }}><RiFileCopyLine size={18} />Copy details</button>
          <a role="menuitem" href={profileHref} className={item}><RiExternalLinkLine size={18} />Open full profile</a>
        </div>
      )}
    </div>
  );
}
