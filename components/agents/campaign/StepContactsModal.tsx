import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RiCloseLine, RiDeleteBin6Line, RiLinkedinBoxFill, RiListUnordered, RiMore2Fill } from "react-icons/ri";
import LeadDrawer from "@/components/agents/LeadDrawer";
import { FloatingMenu } from "@/components/agents/leads/Menu";
import Confirm from "@/components/contacts/Confirm";
import { Avatar } from "@/components/agents/ui";
import { Flames } from "@/components/contacts/cells";

interface StepContact {
  id: string; full_name: string | null; title: string | null; company: string | null; linkedin_url: string | null; profile_image_url: string | null;
  lead_score: number | null; agent_status: string | null; current_step: number; state: string; enrolled_at: string | null;
  signal_title: string | null; signal_count: number; accepted: boolean; step_number: number | null; step_name: string | null;
}

function stamp(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("en-US", { month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" });
}

/**
 * The leads at one campaign step (completed it, not yet at the next), or with `accepted`, everyone
 * who accepted an invitation step: where each one is now, their score and their approval.
 */
export default function StepContactsModal({ agentId, stepId, title, invite = false, accepted = false, onClose, onChanged }: {
  agentId: string; stepId: string; title: string; invite?: boolean; accepted?: boolean; onClose: () => void; onChanged?: () => void;
}) {
  const [rows, setRows] = useState<StepContact[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; id: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const url = `/api/agents/${agentId}/step-contacts?step_id=${encodeURIComponent(stepId)}${accepted ? "&accepted=1" : ""}`;

  const load = useCallback(() => fetch(url).then((r) => (r.ok ? r.json() : { contacts: [] })).then((d: { contacts?: StepContact[] }) => setRows(d.contacts ?? [])).catch(() => setRows([])), [url]);
  useEffect(() => {
    let alive = true;
    fetch(url).then((r) => (r.ok ? r.json() : { contacts: [] })).then((d: { contacts?: StepContact[] }) => { if (alive) setRows(d.contacts ?? []); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [url]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !open && !deleting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open, deleting]);

  async function act(id: string, body: Record<string, unknown>, ok: string) {
    setBusy(id);
    const r = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    if (!r.ok) return toast.error((await r.json().catch(() => ({}))).error ?? "Could not update this lead");
    toast.success(ok);
    await load();
    onChanged?.();
  }

  const n = rows?.length ?? 0;
  const th = "caps px-4 py-4 text-left text-[15px] font-normal text-base-content/55";
  const td = "border-b border-[var(--border-subtle)] px-4 py-4 align-middle";
  const heading = accepted ? `${rows === null ? "…" : n} Contacts` : `${title} — ${rows === null ? "…" : n} contacts`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={heading}>
      <button type="button" className="absolute inset-0 bg-[#141413]/35" onClick={onClose} aria-label="Close" />
      <div className="relative flex max-h-[92vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-[14px] bg-base-100 shadow-[var(--shadow-popover)]">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-6 py-5">
          <h2 className="min-w-0 truncate text-[26px] font-medium leading-tight text-base-content">{heading}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] text-base-content/55 hover:bg-base-200 hover:text-base-content"><RiCloseLine size={26} /></button>
        </header>
        {!accepted && (
          <p className="border-b border-[var(--border-subtle)] px-7 py-4 text-[17px] text-base-content/65">
            {invite ? `${n} contact${n === 1 ? " was" : "s were"} invited: waiting for them to accept, or accepted and waiting for the next step.` : <>{n} contacts have completed this step and haven&apos;t moved to the next one yet.</>}
          </p>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">
          <table className="w-full table-fixed border-separate border-spacing-0">
            <colgroup><col className="w-[25%]" /><col className="w-[24%]" /><col className="w-[9%]" /><col className="w-[15%]" /><col className="w-[12%]" /><col className="w-[15%]" /></colgroup>
            <thead className="sticky top-0 z-10 bg-base-200">
              <tr><th className={`${th} rounded-l-[10px] pl-7`}>Contact</th><th className={th}>Signal</th><th className={th}>Score</th><th className={th}>Campaign status</th><th className={th}>Date</th><th className={`${th} rounded-r-[10px]`}>Fit</th></tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={6} className="py-14 text-center text-[16px] text-base-content/45">Loading…</td></tr>}
              {rows !== null && n === 0 && <tr><td colSpan={6} className="py-14 text-center text-[16px] text-base-content/50">No contacts found</td></tr>}
              {rows?.map((c) => {
                const approved = c.agent_status === "approved" || c.agent_status === "enrolled";
                const rejectable = c.agent_status !== "skipped" && c.agent_status !== "disqualified";
                return (
                  <tr key={c.id} onClick={() => setOpen(c.id)} className="cursor-pointer transition-colors hover:bg-base-200/50">
                    <td className={`${td} pl-7`}>
                      <div className="flex min-w-0 items-center gap-3.5">
                        <Avatar name={c.full_name} src={c.profile_image_url} size={50} />
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[17.5px] text-[#2f5fd8]">{c.full_name ?? "Unknown"}</span>
                            {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="shrink-0 text-[#0a66c2] hover:opacity-80" aria-label="LinkedIn profile"><RiLinkedinBoxFill size={19} /></a>}
                          </div>
                          {c.title && <div className="truncate text-[15.5px] text-base-content/70">{c.title}</div>}
                          {c.company && <div className="truncate text-[15.5px] text-base-content/60"><span className="text-base-content/35">@</span>{c.company}</div>}
                        </div>
                      </div>
                    </td>
                    <td className={td}>
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-[15.5px] text-base-content/75">{c.signal_title ?? "—"}</span>
                        {c.signal_count > 1 && <span className="shrink-0 rounded-[6px] bg-base-200 px-2.5 py-0.5 text-[15px] text-base-content/70">+{c.signal_count - 1} signal{c.signal_count - 1 === 1 ? "" : "s"}</span>}
                      </div>
                    </td>
                    <td className={td}>{c.lead_score != null ? <Flames score={c.lead_score} size={24} /> : <span className="text-base-content/35">—</span>}</td>
                    <td className={td}>
                      {c.step_number ? <>
                        <div className="text-[17px] font-semibold text-base-content">Step {c.step_number}</div>
                        <div className="truncate text-[15.5px] text-base-content/65">{c.step_name}</div>
                        {c.accepted && <div className="text-[15.5px] font-medium text-[#1f9d55]">(Accepted)</div>}
                      </> : <span className="text-[15px] text-base-content/45">—</span>}
                    </td>
                    <td className={`${td} text-[15.5px] text-base-content/65`}>{stamp(c.enrolled_at)}</td>
                    <td className={td} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        {approved ? <span className="rounded-full border border-[#1f9d55]/30 bg-[#1f9d55]/12 px-3 py-1 text-[15.5px] text-[#16803f]">Approved</span>
                          : c.agent_status === "skipped" ? <span className="rounded-full bg-base-200 px-3 py-1 text-[15px] text-base-content/60">Rejected</span>
                          : c.agent_status ? <span className="rounded-full bg-base-200 px-3 py-1 text-[15px] text-base-content/60">{c.agent_status === "drafted" ? "To review" : c.agent_status.replace(/_/g, " ")}</span> : null}
                        {rejectable && <button type="button" disabled={busy === c.id} onClick={() => act(c.id, { action: "skip", reason: "Rejected from the campaign" }, "Lead rejected")}
                          className="h-9 rounded-[6px] border border-[var(--border-subtle)] bg-base-100 px-3 text-[15.5px] text-base-content/80 hover:border-error/40 hover:text-error disabled:opacity-50">Reject</button>}
                        <button type="button" aria-label={`Actions for ${c.full_name ?? "lead"}`} onClick={(e) => setMenu({ anchor: e.currentTarget, id: c.id })}
                          className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-base-content/55 hover:bg-base-200 hover:text-base-content"><RiMore2Fill size={21} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="flex items-center justify-end gap-6 border-t border-[var(--border-subtle)] px-7 py-4">
          <span className="text-[16px] text-base-content/50">{n ? `1–${n}` : "1–0"} of {n} contact(s)</span>
          <button type="button" className="h-10 px-3 text-[16.5px] text-base-content/85 hover:text-base-content" onClick={onClose}>Close</button>
        </footer>
      </div>
      {menu && (
        <FloatingMenu anchor={menu.anchor} label="Lead actions" width={260} onClose={() => setMenu(null)} items={[
          { label: "Remove from list", icon: <RiListUnordered size={19} />, onSelect: () => { const id = menu.id; setMenu(null); void act(id, { action: "remove" }, "Removed from the list and campaign"); } },
          { label: "Delete permanently", icon: <RiDeleteBin6Line size={19} />, danger: true, onSelect: () => { const id = menu.id; setMenu(null); setDeleting(id); } },
        ]} />
      )}
      {deleting && (
        <Confirm title="Delete Contact" action="Delete" text="Are you sure you want to delete this contact? This action cannot be undone!"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const r = await fetch("/api/targets", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_ids: [deleting] }) });
            if (!r.ok) { toast.error("Could not delete the contact"); return; }
            toast.success("Contact deleted"); setDeleting(null); await load(); onChanged?.();
          }} />
      )}
      <LeadDrawer targetId={open} onClose={() => setOpen(null)} onChanged={() => { void load(); onChanged?.(); }} siblings={rows?.map((r) => r.id)} onOpen={setOpen} />
    </div>
  );
}
