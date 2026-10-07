import { useState } from "react";
import { toast } from "sonner";
import { RiEyeLine, RiLinkedinBoxLine, RiLoader4Line, RiMagicLine, RiMailLine, RiRefreshLine, RiSaveLine, RiUserAddLine, RiUserSearchLine } from "react-icons/ri";
import { ghostBtn, inputCls, textareaCls } from "@/components/agents/ui";

export interface Draft { id: string; step_id: string | null; channel: string; subject: string | null; body: string; status: string; auto_approve_at: string | null }
export interface Step { id: string; track: string; step_type: string; day: number; position: number | null; channel: string | null; label: string; draft: Draft | null }

const ICON: Record<string, typeof RiMailLine> = { connect: RiUserAddLine, visit: RiUserSearchLine, message: RiLinkedinBoxLine, email: RiMailLine, sales_inmail: RiLinkedinBoxLine };

function when(day: number): string {
  return day === 0 ? "Right away" : `Day ${day}`;
}

function StepDraft({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<"save" | "regen" | "refine" | null>(null);
  const [preview, setPreview] = useState(false);
  const editable = draft.status === "pending";
  const dirty = body !== draft.body || (draft.channel === "email" && subject !== (draft.subject ?? ""));

  async function save() {
    setBusy("save");
    const r = await fetch(`/api/approvals/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "save", body, subject: draft.channel === "email" ? subject : undefined }) });
    setBusy(null);
    if (!r.ok) return toast.error((await r.json()).error ?? "Could not save");
    onChange({ ...draft, body, subject: draft.channel === "email" ? subject : draft.subject });
    toast.success("Saved");
  }

  async function rewrite(withInstruction: boolean) {
    if (withInstruction && !instruction.trim()) return;
    setBusy(withInstruction ? "refine" : "regen");
    const r = await fetch(`/api/approvals/${draft.id}/regenerate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction: withInstruction ? instruction : null }) });
    const d = await r.json();
    setBusy(null);
    if (!r.ok) return toast.error(d.error ?? "Could not rewrite");
    setBody(d.draft.body); setSubject(d.draft.subject ?? ""); setInstruction("");
    onChange(d.draft);
  }

  if (!editable) {
    return (
      <div className="rounded-xl bg-base-200 p-3 text-sm whitespace-pre-wrap text-base-content/75">
        {draft.subject && <div className="mb-1 font-medium">{draft.subject}</div>}
        {draft.body}
        <div className="mt-2 text-[11px] uppercase tracking-wide text-base-content/40">{draft.status === "consumed" ? "Sent" : draft.status}</div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button className={ghostBtn} disabled={!!busy} onClick={() => rewrite(false)}>{busy === "regen" ? <RiLoader4Line className="animate-spin" size={13} /> : <RiRefreshLine size={13} />} Regenerate</button>
      </div>
      {preview ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-base-100 p-3 text-sm whitespace-pre-wrap">{draft.channel === "email" && <div className="mb-2 font-medium">{subject}</div>}{body}</div>
      ) : (
        <>
          {draft.channel === "email" && <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />}
          <textarea className={textareaCls} rows={Math.min(10, Math.max(4, body.split("\n").length + 1))} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Message" />
        </>
      )}
      <div className="flex items-center gap-2">
        <RiMagicLine size={14} className="shrink-0 text-[var(--viz-4,#7c5cff)]" />
        <input className={`${inputCls} h-9`} placeholder="Refine with AI — e.g. make it shorter, change the CTA" value={instruction} onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => e.key === "Enter" && rewrite(true)} />
        <button className={ghostBtn} disabled={!!busy || !instruction.trim()} onClick={() => rewrite(true)}>{busy === "refine" ? <RiLoader4Line className="animate-spin" size={13} /> : null}Refine</button>
      </div>
      <div className="flex items-center justify-between text-xs text-base-content/45">
        <button className={ghostBtn} onClick={() => setPreview(!preview)}><RiEyeLine size={13} /> {preview ? "Edit" : "Preview"}</button>
        <span className="flex items-center gap-2">{dirty ? "Unsaved changes" : "Nothing to save yet"}
          <button className={ghostBtn} disabled={!dirty || !!busy} onClick={save}><RiSaveLine size={13} /> Save</button></span>
      </div>
    </div>
  );
}

/** The campaign as a vertical timeline, with this contact's draft (editable while pending) at each writing step. */
export default function SequenceEditor({ steps, onDraftChange }: { steps: Step[]; onDraftChange?: (d: Draft) => void }) {
  if (!steps.length) return <p className="text-sm text-base-content/45">This agent has no campaign yet.</p>;
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const Icon = ICON[s.step_type] ?? RiLinkedinBoxLine;
        return (
          <li key={s.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] text-[11px] font-semibold">{i + 1}</span>
              {i < steps.length - 1 && <span className="mt-1 w-px flex-1 bg-[var(--border-subtle)]" />}
            </div>
            <div className="min-w-0 flex-1 pb-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium"><Icon size={14} className="text-base-content/50" />{s.label}{s.position ? <span className="text-xs font-normal text-base-content/40">#{s.position}</span> : null}</span>
                <span className="text-xs text-base-content/45">{when(s.day)}</span>
              </div>
              <div className="mt-1.5">
                {s.draft ? <StepDraft key={s.draft.id} draft={s.draft} onChange={(d) => onDraftChange?.(d)} />
                  : s.step_type === "connect" ? <p className="text-xs text-base-content/50">A connection request is sent to this contact.</p>
                  : s.step_type === "visit" ? <p className="text-xs text-base-content/50">The contact&apos;s LinkedIn profile is visited.</p>
                  : <p className="text-xs text-base-content/45">Written by the campaign&apos;s own content or AI step at send time.</p>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
