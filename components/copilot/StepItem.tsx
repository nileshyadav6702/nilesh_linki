import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  RiArrowDownSLine, RiCheckDoubleLine, RiEyeLine, RiLoader4Line, RiMicLine, RiRefreshLine, RiSave3Line, RiSparkling2Line, RiThumbUpLine, RiUserAddLine,
} from "react-icons/ri";
import { Avatar } from "@/components/agents/ui";
import type { DraftRow, LeadDetail } from "@/lib/agents/copilot";

/** One step of a lead's campaign sequence in Copilot: what happens, when, and the AI message for writing steps. */

export type Step = LeadDetail["sequence"][number];

async function call<T>(url: string, method: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "Something went wrong");
  return d as T;
}

function Line({ icon, title, text }: { icon: ReactNode; title?: string; text: string }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <span className="mt-0.5 shrink-0 text-[#5b4fd6]">{icon}</span>
      <div>{title && <div className="text-[17px] text-base-content">{title}</div>}<div className="text-[17px] text-base-content/75">{text}</div></div>
    </div>
  );
}

/** The blurred placeholder shown until the message is revealed (or written). */
function Hidden({ kind, busy, onView }: { kind: "message" | "email"; busy: boolean; onView: () => void }) {
  return (
    // The content sets the height; the blurred "text" sits behind it, so the button is never clipped.
    <div className={`relative overflow-hidden rounded-[12px] border border-[#e9c9ef] bg-gradient-to-br from-[#f7e8f7] to-[#f1e4f4] ${kind === "email" ? "min-h-[260px]" : ""}`}>
      <div className="pointer-events-none absolute inset-0 select-none space-y-2 px-6 py-5 blur-[5px]" aria-hidden="true">
        <div className="h-3 w-40 rounded bg-base-content/15" />
        {kind === "email" && <div className="flex gap-3 pt-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-4 w-10 rounded bg-base-content/15" />)}</div>}
        <div className="h-3 w-3/4 rounded bg-base-content/10" />
        <div className="h-3 w-2/3 rounded bg-base-content/10" />
      </div>
      <div className={`relative flex flex-col items-center justify-center gap-2 px-4 py-6 text-center ${kind === "email" ? "min-h-[260px]" : ""}`}>
        <div className="flex items-center gap-2 text-[19px] font-medium text-[#a020c4]"><RiSparkling2Line size={20} /> AI contextual {kind} <RiSparkling2Line size={20} /></div>
        <div className="text-[15px] text-[#a020c4]/90">The {kind} is personalized based on your business and the lead&apos;s details</div>
        <button type="button" onClick={onView} disabled={busy}
          className="mt-1 inline-flex h-10 min-w-[56px] items-center justify-center rounded-[8px] border border-[#e9c9ef] bg-base-100 px-4 text-[15px] text-[#a020c4] shadow-sm hover:bg-[#fdf6fd] disabled:opacity-80">
          {busy ? <RiLoader4Line size={20} className="animate-spin" /> : kind === "email" ? "View email" : "View message"}
        </button>
      </div>
    </div>
  );
}

/** Editor for a revealed draft: regenerate, edit, refine with AI, preview, save. Read-only once approved. */
function DraftEditor({ draft, onChange, sender }: { draft: DraftRow; onChange: (d: DraftRow) => void; sender: { name: string; photo: string | null } }) {
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<"regen" | "refine" | "save" | null>(null);
  const [preview, setPreview] = useState(false);
  const email = draft.channel === "email";
  const editable = draft.status === "pending";
  const dirty = body !== draft.body || (email && subject !== (draft.subject ?? ""));

  async function rewrite(kind: "regen" | "refine") {
    setBusy(kind);
    try {
      const { draft: next } = await call<{ draft: DraftRow }>(`/api/approvals/${draft.id}/regenerate`, "POST", { instruction: kind === "refine" ? instruction : null });
      setBody(next.body); setSubject(next.subject ?? ""); setInstruction(""); onChange(next);
      toast.success(kind === "refine" ? "Message refined" : "New version written");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not rewrite the message"); }
    finally { setBusy(null); }
  }
  async function save() {
    setBusy("save");
    try {
      await call(`/api/approvals/${draft.id}`, "PATCH", { decision: "save", body, ...(email ? { subject } : {}) });
      onChange({ ...draft, body, subject: email ? subject : draft.subject });
      toast.success("Saved");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not save"); }
    finally { setBusy(null); }
  }

  const fieldCls = "w-full rounded-[10px] border border-[var(--border-subtle)] bg-base-100 px-5 py-4 text-[17px] leading-relaxed text-base-content outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-[var(--ring)] disabled:bg-base-200/40";
  return (
    <div className="wizard-rise space-y-4">
      {email && <input className={`${fieldCls} !py-3`} value={subject} disabled={!editable} onChange={(e) => setSubject(e.target.value)} aria-label="Email subject" placeholder="Subject" />}
      {editable && (
        <div className="flex justify-end">
          <button type="button" onClick={() => void rewrite("regen")} disabled={!!busy} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-3 text-[15px] hover:bg-base-200 disabled:opacity-60">
            <RiRefreshLine size={16} className={busy === "regen" ? "animate-spin" : ""} /> Regenerate
          </button>
        </div>
      )}
      <textarea className={`${fieldCls} min-h-[180px] resize-y`} value={body} disabled={!editable || busy === "regen"} onChange={(e) => setBody(e.target.value)} aria-label={email ? "Email body" : "Message"} rows={Math.min(14, Math.max(6, body.split("\n").length + 1))} />
      {editable && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[17px] text-[#a020c4]"><RiSparkling2Line size={18} /> Refine with AI</div>
          <form className="flex items-center gap-2 rounded-[10px] border border-[#e9c9ef] bg-base-100 p-1.5 pl-4" onSubmit={(e) => { e.preventDefault(); if (instruction.trim()) void rewrite("refine"); }}>
            <input className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-base-content/40" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g: make it shorter, change the CTA" aria-label="Refine instruction" />
            <button type="submit" disabled={!instruction.trim() || !!busy} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#f6e3f6] px-4 text-[15px] text-[#a020c4] hover:bg-[#f1d6f2] disabled:opacity-60">
              {busy === "refine" ? <RiLoader4Line size={16} className="animate-spin" /> : <RiSparkling2Line size={16} />} Refine
            </button>
          </form>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setPreview(!preview)} className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-4 text-[15px] hover:bg-base-200">
          <RiEyeLine size={17} /> {preview ? "Hide preview" : "Preview"}
        </button>
        {editable ? (
          <div className="flex items-center gap-3">
            <span className="text-[15px] text-base-content/55">{dirty ? "Unsaved changes" : "Nothing to save yet"}</span>
            <button type="button" onClick={() => void save()} disabled={!dirty || !!busy} className="inline-flex h-10 items-center gap-1.5 rounded-[8px] bg-primary px-4 text-[15px] font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:bg-base-200 disabled:text-base-content/35">
              {busy === "save" ? <RiLoader4Line size={16} className="animate-spin" /> : <RiSave3Line size={16} />} Save
            </button>
          </div>
        ) : <span className="text-[15px] text-success">{draft.status === "consumed" ? "Sent" : "Approved"}</span>}
      </div>
      {preview && (
        <div className="wizard-rise overflow-hidden rounded-[12px] border border-[var(--border-subtle)] bg-base-100">
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-3.5 text-[15px]"><RiEyeLine size={18} className="text-[#5b4fd6]" /> This is how the lead will see your {email ? "email" : "message"}</div>
          <div className="flex gap-3 px-5 py-5">
            <Avatar name={sender.name} src={sender.photo} size={40} />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">{sender.name}</div>
              {email && subject && <div className="mt-1 text-[15px] font-medium">{subject}</div>}
              <div className="mt-2 whitespace-pre-wrap rounded-[12px] bg-primary/[0.07] px-5 py-4 text-[15px] leading-relaxed">{body}</div>
              <div className="mt-2 flex items-center gap-2 text-[13px] text-base-content/45">Just now <RiCheckDoubleLine size={16} className="text-[#5b4fd6]" /></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function whenLabel(day: number, firstLaunch: string | null): string {
  if (day > 0) return `In ${day} Day${day === 1 ? "" : "s"}`;
  if (!firstLaunch) return "Today";
  const h = Math.round((new Date(firstLaunch).getTime() - Date.now()) / 3_600_000);
  return h <= 0 ? "Now" : `In ${h} Hour${h === 1 ? "" : "s"}`;
}

export default function StepItem({ n, step, targetId, firstLaunch, sender, onDraft }: {
  n: number; step: Step; targetId: string; firstLaunch: string | null; sender: { name: string; photo: string | null }; onDraft: (stepId: string, d: DraftRow) => void;
}) {
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(false);
  const writes = step.step_type === "message" || step.step_type === "email" || step.step_type === "sales_inmail";
  const kind = step.step_type === "email" ? "email" : "message";

  async function view() {
    if (step.draft) { setShown(true); return; }
    setLoading(true);
    try {
      const { draft } = await call<{ draft: DraftRow }>(`/api/copilot/${targetId}`, "POST", { action: "generate", step_id: step.id });
      onDraft(step.id, draft);
      setShown(true);
      toast.success(`${kind === "email" ? "Email" : "Linkedin"} AI-contextual ${kind} generated`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not write the message"); }
    finally { setLoading(false); }
  }

  let body: ReactNode = null;
  if (step.step_type === "connect") body = <Line icon={<RiUserAddLine size={22} />} text="A LinkedIn connection invitation will be sent to this contact" />;
  else if (step.step_type === "visit") body = <Line icon={<RiEyeLine size={22} className="text-success" />} title="Profile Visit" text="The contact's LinkedIn profile will be visited" />;
  else if (step.step_type === "like_posts") body = <Line icon={<RiThumbUpLine size={22} />} text="The contact's recent posts will be liked" />;
  else if (step.step_type === "voice") body = <Line icon={<RiMicLine size={22} className="text-[#a020c4]" />} title="Voice Message" text="A voice message will be sent to this contact" />;
  else if (writes && step.fixed) body = <div className="text-[15px] text-base-content/60">Same {kind} for every lead, set in the agent&apos;s Campaign tab.</div>;
  else if (writes) body = shown && step.draft
    ? <DraftEditor key={step.draft.id} draft={step.draft} sender={sender} onChange={(d) => onDraft(step.id, d)} />
    : <Hidden kind={kind} busy={loading} onView={() => void view()} />;

  return (
    <li className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-4 py-3 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-base-100 text-[15px] tabular-nums">{n}</span>
        <span className="flex flex-1 items-center gap-2 text-[17px] font-medium">{step.label}{writes && !step.fixed && <RiSparkling2Line size={20} className="text-[#c04ad6]" />}</span>
        <span className="text-[15px] text-base-content/60">{whenLabel(step.day, firstLaunch)}</span>
        <RiArrowDownSLine size={22} className={`shrink-0 text-base-content/60 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && body && <div className="wizard-rise ml-[18px] border-l border-[var(--border-strong)] pb-4 pl-8 pt-1">{body}</div>}
    </li>
  );
}
