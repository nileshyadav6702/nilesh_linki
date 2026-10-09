import { format } from "date-fns";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";

/** Credits usage log: one page of grants, debits and refunds, newest first. */

export interface UsageRow { id: string; type: string; label: string; credits: number; units: number | null; note: string | null; created_at: string }
export interface UsagePage { rows: UsageRow[]; total: number; page: number; page_size: number }

const when = (s: string) => { const d = new Date(`${s.replace(" ", "T")}Z`); return Number.isNaN(d.getTime()) ? s : format(d, "MMM d, yyyy, h:mm a"); };

function detail(r: UsageRow): string | null {
  if (r.type === "lead_import" || r.type === "engager_import") return r.units ? `${r.units} lead${r.units === 1 ? "" : "s"}` : null;
  if (r.type === "monthly_grant") return r.units ? `${r.units} member${r.units === 1 ? "" : "s"}` : null;
  return r.note;
}

export default function CreditsUsage({ usage, loading, onPage }: { usage: UsagePage; loading: boolean; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(usage.total / usage.page_size));
  const from = usage.total ? (usage.page - 1) * usage.page_size + 1 : 0;
  const to = Math.min(usage.total, usage.page * usage.page_size);
  if (!usage.total) return <div className="px-8 pb-7 text-[16px] text-base-content/60">No credits used yet.</div>;
  return (
    <div className="px-8 pb-7">
      <div className={`overflow-x-auto rounded-[12px] border border-[var(--border-subtle)] transition-opacity ${loading ? "opacity-60" : ""}`}>
        <table className="w-full min-w-[560px] text-[16px]">
          <thead><tr className="text-left text-[15px] font-medium text-base-content/60"><th className="px-5 py-3.5 font-medium">Date</th><th className="px-5 py-3.5 font-medium">Type</th><th className="px-5 py-3.5 text-right font-medium">Credits</th></tr></thead>
          <tbody>
            {usage.rows.map((r) => {
              const d = detail(r);
              return (
                <tr key={r.id} className="border-t border-[var(--border-subtle)]">
                  <td className="whitespace-nowrap px-5 py-3.5 text-base-content/80">{when(r.created_at)}</td>
                  <td className="px-5 py-3.5">{r.label}{d && <span className="ml-2 text-[14px] text-base-content/50">{d}</span>}</td>
                  <td className="px-5 py-3.5 text-right font-medium tabular-nums" style={{ color: r.credits > 0 ? "#1f8a4c" : undefined }}>{r.credits > 0 ? `+${r.credits}` : r.credits}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[15px] text-base-content/60">Showing {from}–{to} of {usage.total}</span>
        <div className="inline-flex items-center overflow-hidden rounded-[10px] border border-[var(--border-subtle)]">
          <button type="button" aria-label="Previous page" disabled={usage.page <= 1 || loading} onClick={() => onPage(usage.page - 1)} className="flex h-10 w-11 items-center justify-center hover:bg-base-200 disabled:cursor-default disabled:bg-base-200/60 disabled:text-base-content/30"><LuChevronLeft size={18} /></button>
          <span className="border-x border-[var(--border-subtle)] px-4 text-[15px] font-medium leading-10 tabular-nums">Page {usage.page} / {pages}</span>
          <button type="button" aria-label="Next page" disabled={usage.page >= pages || loading} onClick={() => onPage(usage.page + 1)} className="flex h-10 w-11 items-center justify-center hover:bg-base-200 disabled:cursor-default disabled:bg-base-200/60 disabled:text-base-content/30"><LuChevronRight size={18} /></button>
        </div>
      </div>
    </div>
  );
}
