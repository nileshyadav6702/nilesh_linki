import { useState } from "react";
import { toast } from "sonner";
import { RiEyeLine, RiLinkedinBoxFill, RiLoader4Line, RiMailLine, RiMailSendLine, RiRefreshLine, RiSaveLine, RiSparkling2Line, RiTimeLine, RiUserAddLine } from "react-icons/ri";
import { ghostBtn, IconTile, inputCls, textareaCls, type Tone } from "@/components/agents/ui";

export interface Draft { id: string; step_id: string | null; channel: string; subject: string | null; body: string; status: string; auto_approve_at: string | null }
export interface Step { id: string; track: string; step_type: string; day: number; position: number | null; channel: string | null; label: string; draft: Draft | null }

const ICON: Record<string, { Icon: typeof RiMailLine; tone: Tone }> = {
  connect: { Icon: RiUserAddLine, tone: "linkedin" }, visit: { Icon: RiEyeLine, tone: "amber" }, message: { Icon: RiLinkedinBoxFill, tone: "linkedin" },
  email: { Icon: RiMailLine, tone: "coral" }, sales_inmail: { Icon: RiMailSendLine, tone: "linkedin" },
};

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
      <div className="rounded-[10px] bg-base-200 p-3 text-sm whitespace-pre-wrap text-base-content/75">
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
        <div className="rounded-[10px] border border-[var(--border-subtle)] bg-base-100 p-3 text-sm whitespace-pre-wrap">{draft.channel === "email" && <div className="mb-2 font-medium">{subject}</div>}{body}</div>
      ) : (
        <>
          {draft.channel === "email" && <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />}
          <textarea className={textareaCls} rows={Math.min(10, Math.max(4, body.split("\n").length + 1))} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Message" />
        </>
      )}
      <div className="flex items-center gap-2">
        <RiSparkling2Line size={14} className="shrink-0 text-primary" />
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
    <ol className="space-y-4">
      {steps.map((s, i) => {
        const { Icon, tone } = ICON[s.step_type] ?? ICON.message;
        return (
          <li key={s.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-content">{i + 1}</span>
              {i < steps.length - 1 && <span className="mt-1 w-px flex-1 bg-[var(--border-subtle)]" />}
            </div>
            <div className="min-w-0 flex-1 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <IconTile icon={<Icon size={15} />} tone={tone} size={32} />
                  <span className="truncate">{s.label}</span>{s.position ? <span className="text-xs font-normal text-base-content/40">#{s.position}</span> : null}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-[#e8a55a] bg-[#e8a55a]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#b8742a]"><RiTimeLine size={12} />{when(s.day)}</span>
              </div>
              <div className="mt-3">
                {s.draft ? <StepDraft key={s.draft.id} draft={s.draft} onChange={(d) => onDraftChange?.(d)} />
                  : s.step_type === "connect" ? <p className="rounded-[10px] bg-base-200 px-3 py-2 text-xs text-base-content/55">A connection request is sent to this contact.</p>
                  : s.step_type === "visit" ? <p className="rounded-[10px] bg-base-200 px-3 py-2 text-xs text-base-content/55">The contact&apos;s LinkedIn profile is visited.</p>
                  : <p className="rounded-[10px] bg-base-200 px-3 py-2 text-xs text-base-content/50">Written by the campaign&apos;s own content or AI step at send time.</p>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
