import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RiCloseLine, RiLinkedinBoxFill } from "react-icons/ri";
import LeadDrawer from "@/components/agents/LeadDrawer";
import { Avatar, Flames, Pill, secondaryBtn, type Tone } from "@/components/agents/ui";

interface StepContact {
  id: string; full_name: string | null; title: string | null; company: string | null; linkedin_url: string | null; profile_image_url: string | null;
  lead_score: number | null; agent_status: string | null; current_step: number; state: string; last_step_at: string | null;
  signal_title: string | null; signal_count: number;
}

const FIT: Record<string, { label: string; tone: Tone }> = {
  approved: { label: "Approved", tone: "success" }, enrolled: { label: "Approved", tone: "success" },
  needs_data: { label: "Needs data", tone: "amber" }, skipped: { label: "Rejected", tone: "ink" }, disqualified: { label: "Not a fit", tone: "ink" },
};

function stamp(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("en-US", { month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" });
}

/** The leads that completed one campaign step and have not moved to the next one yet. */
export default function StepContactsModal({ agentId, stepId, title, onClose, onChanged }: { agentId: string; stepId: string; title: string; onClose: () => void; onChanged?: () => void }) {
  const [rows, setRows] = useState<StepContact[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => fetch(`/api/agents/${agentId}/step-contacts?step_id=${encodeURIComponent(stepId)}`)
    .then((r) => r.ok ? r.json() : { contacts: [] }).then((d: { contacts?: StepContact[] }) => setRows(d.contacts ?? [])).catch(() => setRows([])), [agentId, stepId]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/agents/${agentId}/step-contacts?step_id=${encodeURIComponent(stepId)}`)
      .then((r) => r.ok ? r.json() : { contacts: [] }).then((d: { contacts?: StepContact[] }) => { if (alive) setRows(d.contacts ?? []); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [agentId, stepId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !open) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  async function reject(id: string) {
    setBusy(id);
    const r = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "skip", reason: "Rejected from the campaign" }) });
    setBusy(null);
    if (!r.ok) return toast.error((await r.json().catch(() => ({}))).error ?? "Could not reject this lead");
    toast.success("Lead rejected");
    await load();
    onChanged?.();
  }

  const n = rows?.length ?? 0;
  const th = "px-4 py-3 text-left text-[12px] font-medium uppercase tracking-[1.2px] text-base-content/50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 bg-[#141413]/25" onClick={onClose} aria-label="Close" />
      <div className="relative flex max-h-[90vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-[12px] bg-base-100 shadow-[var(--shadow-popover)]">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-6 py-4">
          <h2 className="min-w-0 truncate font-display text-[24px] leading-tight text-base-content">{title} — {rows === null ? "…" : n} contacts</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-base-content/45 hover:bg-base-200 hover:text-base-content"><RiCloseLine size={20} /></button>
        </header>
        <p className="border-b border-[var(--border-subtle)] px-6 py-3 text-sm text-base-content/60">{n} contacts have completed this step and haven&apos;t moved to the next one yet.</p>

        <div className="flex-1 overflow-auto px-6 py-4">
          <table className="w-full min-w-[900px] border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-base-200">
              <tr><th className={`${th} rounded-l-[8px]`}>Contact</th><th className={th}>Signal</th><th className={th}>Score</th><th className={th}>Campaign status</th><th className={th}>Date</th><th className={`${th} rounded-r-[8px]`}>Fit</th></tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={6} className="py-12 text-center text-sm text-base-content/40">Loading…</td></tr>}
              {rows !== null && n === 0 && <tr><td colSpan={6} className="py-12 text-center text-sm text-base-content/50">No contacts found</td></tr>}
              {rows?.map((c) => {
                const fit = FIT[c.agent_status ?? ""];
                const rejectable = c.agent_status !== "skipped" && c.agent_status !== "disqualified";
                return (
                  <tr key={c.id} onClick={() => setOpen(c.id)} className="cursor-pointer transition-colors hover:bg-base-200/50">
                    <td className="border-b border-[var(--border-subtle)] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={c.full_name} src={c.profile_image_url} size={40} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-primary">{c.full_name ?? "Unknown"}</span>
                            {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[#0a66c2] hover:opacity-80" aria-label="LinkedIn profile"><RiLinkedinBoxFill size={16} /></a>}
                          </div>
                          {c.title && <div className="max-w-[240px] truncate text-[13px] text-base-content/65">{c.title}</div>}
                          {c.company && <div className="max-w-[240px] truncate text-[13px] text-base-content/45">@ {c.company}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="border-b border-[var(--border-subtle)] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="max-w-[240px] truncate text-[13px] text-base-content/70">{c.signal_title ?? "—"}</span>
                        {c.signal_count > 1 && <Pill className="shrink-0">+{c.signal_count - 1} signal{c.signal_count - 1 === 1 ? "" : "s"}</Pill>}
                      </div>
                    </td>
                    <td className="border-b border-[var(--border-subtle)] px-4 py-3"><Flames score={c.lead_score} /></td>
                    <td className="border-b border-[var(--border-subtle)] px-4 py-3 text-[13px] font-medium text-base-content">{c.state === "completed" ? "Completed" : "In progress"}</td>
                    <td className="whitespace-nowrap border-b border-[var(--border-subtle)] px-4 py-3 text-[13px] text-base-content/65">{stamp(c.last_step_at)}</td>
                    <td className="border-b border-[var(--border-subtle)] px-4 py-3">
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {fit ? <Pill tone={fit.tone}>{fit.label}</Pill> : <span className="text-[13px] text-base-content/40">—</span>}
                        {rejectable && <button type="button" className={`${secondaryBtn} !h-7 !px-2.5 !text-xs`} disabled={busy === c.id} onClick={() => reject(c.id)}>Reject</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="flex items-center justify-end gap-4 border-t border-[var(--border-subtle)] px-6 py-3.5">
          <span className="text-[13px] text-base-content/50">{n ? `1–${n}` : "1–0"} of {n} contact(s)</span>
          <button type="button" className={secondaryBtn} onClick={onClose}>Close</button>
        </footer>
      </div>
      <LeadDrawer targetId={open} onClose={() => setOpen(null)} onChanged={() => { load(); onChanged?.(); }} siblings={rows?.map((r) => r.id)} onOpen={setOpen} />
    </div>
  );
}
