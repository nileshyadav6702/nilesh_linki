import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  RiAddLine, RiArrowDownSLine, RiCheckDoubleLine, RiErrorWarningLine, RiEyeLine, RiEyeOffLine, RiInformationLine, RiLoader4Line,
  RiPencilLine, RiSparkling2Line, RiStarLine,
} from "react-icons/ri";
import { DELAY_OPTIONS, LEAD_VARIABLES, RadioCard, SideDrawer, STEP_TITLE, Tip, aiName, delayLabel, type CampaignStep } from "@/components/agents/campaign/kit";
import { Avatar, inputCls, primaryBtn, textareaCls, Toggle } from "@/components/agents/ui";

export interface StepSave { fields: Partial<CampaignStep>; delaySeconds?: number; visitBefore?: boolean }

interface Props {
  step: CampaignStep;
  stepNumber: number;
  delayBefore: number | null;
  visitBefore: boolean;
  channelMessageCount: number;
  workflowId: string;
  sampleTargetId: string | null;
  sampleTargetName: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (s: StepSave) => void;
}

type Field = "note" | "message" | "subject" | "body";
interface Preview { subject: string; body: string }

const NOTE_MAX = 180;
const MESSAGE_MAX = 1900;

/** Insert `{{key}}` at the caret of a textarea/input, replacing a just-typed "/" trigger. */
function insertAt(el: HTMLInputElement | HTMLTextAreaElement | null, value: string, key: string, dropSlash: boolean): { text: string; caret: number } {
  const token = `{{${key}}}`;
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const from = dropSlash && value[start - 1] === "/" ? start - 1 : start;
  return { text: value.slice(0, from) + token + value.slice(end), caret: from + token.length };
}

/** "+ Insert variable" dropdown; lead data only (the sender renders nothing else). */
function VariableMenu({ open, onToggle, onPick }: { open: boolean; onToggle: () => void; onPick: (key: string) => void }) {
  return (
    <div className="relative">
      <button type="button" onClick={onToggle} className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[14.5px] font-medium text-base-content/75 hover:bg-base-200">
        <RiAddLine size={15} /> Insert variable <RiArrowDownSLine size={14} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-[10px] border border-[var(--border-subtle)] bg-base-100 p-2 shadow-[var(--shadow-overlay)]">
          <div className="px-2 pb-1 pt-0.5 text-[12.5px] font-semibold uppercase tracking-[1px] text-base-content/45">Lead data</div>
          {LEAD_VARIABLES.map((v) => (
            <button key={v.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(v.key)}
              className="flex w-full items-center rounded-[8px] px-2 py-1.5 text-left hover:bg-base-200">
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[14.5px] font-medium text-primary">{v.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  return <span className={`text-[13.5px] tabular-nums ${n > max * 0.95 ? "text-error" : "text-base-content/45"}`}>{n}/{max}</span>;
}

export default function StepDrawer(props: Props) {
  const { step, stepNumber, delayBefore, visitBefore, channelMessageCount, sampleTargetId, sampleTargetName, busy, onClose, onSave } = props;
  const type = step.step_type;
  const isEmail = type === "email";
  const isConnect = type === "connect";
  const writes = type === "message" || type === "sales_inmail" || isEmail;

  const [withNote, setWithNote] = useState(!!step.connect_note);
  const [note, setNote] = useState(step.connect_note ?? "");
  const [visit, setVisit] = useState(visitBefore);
  const [fixed, setFixed] = useState(step.send_mode === "fixed");
  const [message, setMessage] = useState(step.message_body ?? "");
  const [subject, setSubject] = useState(step.email_subject ?? "");
  const [body, setBody] = useState(step.email_body ?? "");
  const [delay, setDelay] = useState(delayBefore ?? 0);
  const [menu, setMenu] = useState<Field | null>(null);
  const [lastField, setLastField] = useState<Field>(isEmail ? "body" : isConnect ? "note" : "message");
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const refs = { note: useRef<HTMLTextAreaElement>(null), message: useRef<HTMLTextAreaElement>(null), subject: useRef<HTMLInputElement>(null), body: useRef<HTMLTextAreaElement>(null) };
  const values: Record<Field, string> = { note, message, subject, body };
  const setters: Record<Field, (v: string) => void> = { note: setNote, message: setMessage, subject: setSubject, body: setBody };
  const limits: Partial<Record<Field, number>> = { note: NOTE_MAX, message: MESSAGE_MAX };

  function pick(field: Field, key: string, fromSlash = false) {
    const el = refs[field].current;
    const { text, caret } = insertAt(el, values[field], key, fromSlash);
    const max = limits[field];
    if (max && text.length > max) { toast.message(`That would go over ${max} characters`); setMenu(null); return; }
    setters[field](text);
    setMenu(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(caret, caret); });
  }

  /** Typing "/" at the start of a word opens the variable menu for that field. */
  function onType(field: Field, v: string, el: HTMLInputElement | HTMLTextAreaElement) {
    setters[field](v);
    const at = el.selectionStart ?? v.length;
    if (v[at - 1] === "/" && (at === 1 || /\s/.test(v[at - 2]))) { setLastField(field); setMenu(field); }
    else if (menu === field) setMenu(null);
  }

  async function runPreview(ai: boolean) {
    if (!sampleTargetId) return;
    setPreviewing(true);
    try {
      const r = await fetch("/api/workflows/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_id: sampleTargetId, step_type: type, ai_enabled: ai,
          ai_model: typeof step.ai_model === "string" ? step.ai_model : "",
          ai_prompt: typeof step.ai_prompt === "string" ? step.ai_prompt : "",
          message_body: ai ? "" : message, email_subject: ai ? "" : subject, email_body: ai ? "" : body,
        }),
      });
      const x = await r.json();
      if (!r.ok) { toast.error(x.error ?? "Could not build the preview"); return; }
      setPreview({ subject: x.subject ?? "", body: x.body ?? "" });
      setShowPreview(true);
    } catch {
      toast.error("Could not build the preview");
    } finally {
      setPreviewing(false);
    }
  }

  const fixedEmpty = writes && fixed && (isEmail ? !subject.trim() || !body.trim() : !message.trim());
  const noteEmpty = isConnect && withNote && !note.trim();

  function save() {
    const out: StepSave = { fields: {} };
    if (isConnect) {
      out.fields = { connect_note: withNote && note.trim() ? note : null };
      if (visit !== visitBefore) out.visitBefore = visit;
    } else if (writes) {
      out.fields = !fixed ? { send_mode: "ai", ai_enabled: 1 }
        : isEmail ? { send_mode: "fixed", ai_enabled: 0, email_subject: subject, email_body: body }
        : { send_mode: "fixed", ai_enabled: 0, message_body: message };
    }
    if (delayBefore !== null && delay !== delayBefore) out.delaySeconds = delay;
    onSave(out);
  }

  const name = writes ? aiName(step, channelMessageCount) : "";
  const kind = name.replace(/^AI /, "").replace(/ Email$/, "");
  const title = `Edit ${STEP_TITLE[type] ?? "step"} step${writes ? ` (${kind})` : ""}`;
  const delayChoices = delayBefore !== null && !DELAY_OPTIONS.includes(delayBefore) ? [...DELAY_OPTIONS, delayBefore].sort((a, b) => a - b) : DELAY_OPTIONS;
  const noLead = <p className="text-[14.5px] text-base-content/50">Add a lead to this agent to preview.</p>;

  const toolbar = (field: Field, extra?: ReactNode) => (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-base-100 px-2 py-1.5">
      <VariableMenu open={menu === field} onToggle={() => { setLastField(field); setMenu(menu === field ? null : field); }} onPick={(k) => pick(field, k)} />
      <span className="text-[14.5px] text-base-content/40">or type / in the {field === "note" ? "note" : isEmail ? "subject or body" : "message"}</span>
      <span className="ml-auto">{extra}</span>
    </div>
  );

  const aiCard = (
    <RadioCard on={!fixed} onSelect={() => { setFixed(false); setPreview(null); }} badge="Recommended"
      title={<span className="inline-flex items-center gap-1">AI-powered {kind}{isEmail ? " Email" : ""}<RiStarLine size={14} className="text-[#e8a55a]" /></span>}
      subtitle={`Your AI writes a unique ${isEmail ? "email" : "message"} for every lead, using their profile, company, and detected buying signals.`}>
      <div className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-5">
        <div className="font-medium text-base-content">How it works</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-base-content/70">
          <li>AI analyzes the lead (profile, company, signals)</li>
          <li>AI generates a personalized {isEmail ? "email" : "message"}</li>
          <li>You can review &amp; edit it before it&apos;s sent (in the lead&apos;s drawer / Copilot)</li>
        </ul>
        <div className="mt-5 flex flex-col items-center gap-2">
          {sampleTargetId
            ? <button type="button" className={primaryBtn} disabled={previewing} onClick={() => runPreview(true)}>
                {previewing ? <RiLoader4Line size={16} className="animate-spin" /> : <RiSparkling2Line size={16} />} Generate preview for a sample lead
              </button>
            : noLead}
        </div>
        {!fixed && preview && <PreviewBubble preview={preview} isEmail={isEmail} who={sampleTargetName} />}
      </div>
    </RadioCard>
  );

  const fixedCard = (
    <RadioCard on={fixed} onSelect={() => { setFixed(true); setPreview(null); setShowPreview(false); }}
      title={isEmail ? "Same email for everyone" : "Same message for everyone"} subtitle={`Use variables to craft your ${isEmail ? "email" : "message"}`}>
      {isEmail ? (
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-[15px] font-medium text-base-content">Subject</span>
            <input ref={refs.subject} className={inputCls} value={subject} onFocus={() => setLastField("subject")} onChange={(e) => onType("subject", e.target.value, e.target)} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[15px] font-medium text-base-content">Email Body</span>
            <textarea ref={refs.body} rows={9} className={textareaCls} placeholder="Write your email…" value={body} onFocus={() => setLastField("body")} onChange={(e) => onType("body", e.target.value, e.target)} />
          </label>
          <div className="relative">
            {toolbar(lastField === "subject" ? "subject" : "body")}
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-1.5 text-[15px] font-medium text-base-content">Message Content</div>
          <textarea ref={refs.message} rows={8} maxLength={MESSAGE_MAX} className={textareaCls} value={message} onFocus={() => setLastField("message")} onChange={(e) => onType("message", e.target.value, e.target)} />
          {toolbar("message", <Counter n={message.length} max={MESSAGE_MAX} />)}
        </div>
      )}
      <div className="mt-3">
        {!sampleTargetId ? noLead : (
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[var(--border-subtle)] px-3 text-[14.5px] font-medium text-base-content/75 hover:bg-base-200"
            disabled={previewing} onClick={() => (showPreview ? setShowPreview(false) : runPreview(false))}>
            {previewing ? <RiLoader4Line size={14} className="animate-spin" /> : showPreview ? <RiEyeOffLine size={14} /> : <RiEyeLine size={14} />} {showPreview ? "Hide preview" : "Preview"}
          </button>
        )}
        {fixed && showPreview && preview && (
          <div className="mt-3 rounded-[12px] border border-[var(--border-subtle)] bg-base-100">
            <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5 text-[15px] text-base-content/60">Preview as <span className="font-medium text-base-content">{sampleTargetName ?? "a sample lead"}</span></div>
            <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5 text-[14.5px] text-base-content/60"><RiEyeLine size={14} className="text-primary" /> This is how the lead will see your {isEmail ? "email" : "message"}</div>
            <div className="p-4"><PreviewBubble preview={preview} isEmail={isEmail} who={null} /></div>
          </div>
        )}
      </div>
    </RadioCard>
  );

  return (
    <SideDrawer title={title} icon={<RiPencilLine size={18} className="text-base-content/45" />} onClose={onClose}
      footer={<>
        {(fixedEmpty || noteEmpty) && <span className="mr-auto text-[14.5px] text-base-content/50">{noteEmpty ? "Write the note, or send the invitation without one." : "Write the text that everyone will receive."}</span>}
        <button type="button" className="px-3 text-[15px] font-medium text-base-content/70 hover:text-base-content" onClick={onClose}>Cancel</button>
        <button type="button" className={primaryBtn} disabled={busy || fixedEmpty || noteEmpty} onClick={save}>{busy && <RiLoader4Line size={16} className="animate-spin" />} Save Step</button>
      </>}>
      <div className="space-y-5">
        <div className="text-[13.5px] font-medium uppercase tracking-[1.2px] text-base-content/45">Step {stepNumber}</div>

        {isConnect && (
          <>
            <RadioCard on={!withNote} onSelect={() => setWithNote(false)} title="Invitation" subtitle="Simple connection request" />
            <RadioCard on={withNote} onSelect={() => setWithNote(true)} title="Invitation + Note" subtitle="Add a personal message">
              <div className="mb-1.5 text-[15px] font-medium text-base-content">Invitation Note</div>
              <textarea ref={refs.note} rows={5} maxLength={NOTE_MAX} className={textareaCls} value={note} onFocus={() => setLastField("note")} onChange={(e) => onType("note", e.target.value, e.target)} />
              {toolbar("note", <Counter n={note.length} max={NOTE_MAX} />)}
              <p className="mt-3 flex items-start gap-1.5 text-[14.5px] text-error"><RiErrorWarningLine size={15} className="mt-0.5 shrink-0" />If you don&apos;t have Sales Navigator, it&apos;s not recommended to add a note because LinkedIn limits free accounts to a few notes per month.</p>
            </RadioCard>
            <div className="flex items-start justify-between gap-4 border-t border-[var(--border-subtle)] pt-5">
              <div>
                <div className="font-medium text-base-content">Visit profile before sending</div>
                <p className="mt-0.5 text-[15px] text-base-content/55">Your LinkedIn profile visits the lead&apos;s profile before the invitation is sent, so they may see you in their &quot;Who viewed my profile&quot;.</p>
              </div>
              <Toggle on={visit} onChange={() => setVisit((v) => !v)} label="Visit profile before sending" />
            </div>
          </>
        )}

        {writes && <>{aiCard}{fixedCard}</>}

        {delayBefore !== null && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-5 text-[15px] text-base-content/75">
            Wait at least
            <select className={`${inputCls} !h-9 !w-auto pr-8`} value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
              {delayChoices.map((s) => <option key={s} value={s}>{delayLabel(s)}</option>)}
            </select>
            after previous step
            <Tip text="The actual timing depends on when the contact accepts the invitation and on the daily quotas of your account.">
              <RiInformationLine size={16} className="text-base-content/40" />
            </Tip>
          </div>
        )}
      </div>
    </SideDrawer>
  );
}

function PreviewBubble({ preview, isEmail, who }: { preview: Preview; isEmail: boolean; who: string | null }) {
  return (
    <div className="mt-4 flex items-start gap-3">
      <Avatar name={who ?? "You"} size={36} />
      <div className="min-w-0 flex-1">
        <div className="rounded-[12px] bg-primary/[0.07] px-4 py-3 text-[15px] text-base-content">
          {isEmail && preview.subject && <div className="mb-1.5 font-medium">{preview.subject}</div>}
          {preview.body ? <p className="whitespace-pre-wrap">{preview.body}</p> : <p className="italic text-base-content/45">(empty {isEmail ? "email" : "message"})</p>}
        </div>
        <div className="mt-1 flex items-center gap-1 text-[13.5px] text-base-content/45">Just now <RiCheckDoubleLine size={13} className="text-primary" /></div>
      </div>
    </div>
  );
}
