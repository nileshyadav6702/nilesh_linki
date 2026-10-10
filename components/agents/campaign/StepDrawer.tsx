import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  RiAddLine, RiArrowDownSLine, RiCheckDoubleLine, RiCloseLine, RiErrorWarningLine, RiEyeLine, RiInformationLine, RiLoader4Line,
  RiMagicLine, RiPaletteLine, RiPlayLine, RiStarLine, RiThumbUpLine, RiUser3Line,
} from "react-icons/ri";
import { DELAY_OPTIONS, LEAD_VARIABLES, RadioCard, SideDrawer, STEP_TITLE, Tip, aiName, delayLabel, type CampaignStep } from "@/components/agents/campaign/kit";
import { Avatar, Toggle } from "@/components/agents/ui";
import { SearchSelect } from "@/components/agents/sources/kit";

/** A voice recording not uploaded yet (its step isn't saved): attached when the sequence is saved. */
export interface PendingVoice { data: Blob; url: string; ms: number }
export interface StepSave { fields: Partial<CampaignStep>; delaySeconds?: number; visitBefore?: boolean; likeBefore?: boolean; voice?: PendingVoice }

interface Props {
  step: CampaignStep; stepNumber: number; delayBefore: number | null; visitBefore: boolean; likeBefore?: boolean;
  channelMessageCount: number; workflowId: string; agentId: string;
  sampleTargetId: string | null; sampleTargetName: string | null; language?: string | null;
  busy: boolean; onClose: () => void; onSave: (s: StepSave) => void;
}

type Field = "note" | "message" | "subject" | "body";
interface Preview { subject: string | null; body: string }
interface Lead { id: string; full_name: string | null; company: string | null }

const NOTE_MAX = 180;
const MESSAGE_MAX = 1900;
const SENDER_VARIABLES = [
  { key: "sender_first_name", label: "SenderFirstName" }, { key: "sender_name", label: "SenderName" },
  { key: "sender_full_name", label: "SenderFullName" }, { key: "sender_company", label: "SenderCompany" },
] as const;
/** Fields "Map missing fields" can give a default for, with the hint shown when left empty. */
const MAPPABLE = [
  { key: "first_name", label: "FirstName", hint: "Sir" }, { key: "last_name", label: "LastName", hint: "" },
  { key: "company", label: "Company", hint: "Your Company" }, { key: "title", label: "JobTitle", hint: "Removed from the message" },
] as const;
const TOKEN = /\{\{\s*([a-z_]+)\s*(?:\|([^{}]*))?\}\}/gi;

const field = "w-full rounded-[10px] border border-[var(--border-subtle)] bg-base-100 px-4 text-[17px] text-base-content outline-none transition focus:border-[#f0785a]/60 focus:ring-2 focus:ring-[#f0785a]/15";

/** Insert `{{key}}` at the caret, replacing a just-typed "/" trigger. */
function insertAt(el: HTMLInputElement | HTMLTextAreaElement | null, value: string, key: string, dropSlash: boolean): { text: string; caret: number } {
  const token = `{{${key}}}`;
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const from = dropSlash && value[start - 1] === "/" ? start - 1 : start;
  return { text: value.slice(0, from) + token + value.slice(end), caret: from + token.length };
}

/** A textarea whose {{variables}} show as blue chips (a highlight layer under transparent text). */
function TokenArea({ value, onChange, inputRef, rows, maxLength, placeholder, onFocus }: {
  value: string; onChange: (v: string, el: HTMLTextAreaElement) => void; inputRef: React.RefObject<HTMLTextAreaElement | null>;
  rows: number; maxLength?: number; placeholder?: string; onFocus?: () => void;
}) {
  const back = useRef<HTMLDivElement>(null);
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of value.matchAll(TOKEN)) {
    parts.push(value.slice(last, m.index));
    parts.push(<span key={m.index} className="rounded-[5px] bg-[#4f7cf0]/12 text-[#2f5fd8] shadow-[0_0_0_1px_rgba(79,124,240,0.25)]">{m[0]}</span>);
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(value.slice(last) + "\n");
  const shared = "whitespace-pre-wrap break-words px-5 py-4 text-[17px] leading-[1.7]";
  return (
    <div className="relative rounded-[12px] border border-[var(--border-subtle)] bg-base-100 focus-within:border-[#f0785a]/60 focus-within:ring-2 focus-within:ring-[#f0785a]/15">
      <div ref={back} aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden text-base-content ${shared}`}>{parts}</div>
      <textarea ref={inputRef} rows={rows} maxLength={maxLength} value={value} placeholder={placeholder} onFocus={onFocus}
        onScroll={(e) => { if (back.current) back.current.scrollTop = e.currentTarget.scrollTop; }}
        onChange={(e) => onChange(e.target.value, e.target)}
        className={`relative block w-full resize-y bg-transparent text-transparent caret-base-content outline-none selection:bg-[#4f7cf0]/25 selection:text-transparent placeholder:text-base-content/35 ${shared}`} />
    </div>
  );
}

/** "+ Insert variable": lead data and sender data, as chips. */
function VariableMenu({ open, onToggle, onPick }: { open: boolean; onToggle: () => void; onPick: (key: string) => void }) {
  const group = (title: string, items: ReadonlyArray<{ key: string; label: string }>, cls: string) => (
    <>
      <div className="caps px-3 pb-2 pt-3 text-[14px] text-base-content/50">{title}</div>
      {items.map((v) => (
        <button key={v.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(v.key)} className="flex w-full items-center rounded-[8px] px-3 py-1.5 text-left hover:bg-[#f0785a]/8">
          <span className={`rounded-full border px-3 py-0.5 text-[15.5px] ${cls}`}>{v.label}</span>
        </button>
      ))}
    </>
  );
  return (
    <div className="relative">
      <button type="button" onClick={onToggle} className="inline-flex h-10 items-center gap-1.5 rounded-[8px] px-2.5 text-[15.5px] font-medium text-base-content/80 hover:bg-base-200">
        <RiAddLine size={18} /> Insert variable <RiArrowDownSLine size={17} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-[340px] w-72 overflow-y-auto rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1.5 shadow-[var(--shadow-overlay)]">
          <div className="caps px-3 pt-2 text-[14px] text-base-content/45">Variables</div>
          {group("Lead data", LEAD_VARIABLES, "border-[#4f7cf0]/25 bg-[#4f7cf0]/10 text-[#2f5fd8]")}
          {group("Sender data", SENDER_VARIABLES, "border-[#f0785a]/25 bg-[#f0785a]/10 text-[#d9553a]")}
        </div>
      )}
    </div>
  );
}

const Counter = ({ n, max }: { n: number; max: number }) => <span className={`text-[15px] tabular-nums ${n > max * 0.95 ? "text-error" : "text-base-content/50"}`}>{n}/{max}</span>;

/** Defaults for missing contact fields, written into the step's text as {{key|default}}. */
function MapMissing({ texts, onApply, onClose }: { texts: string[]; onApply: (map: Record<string, string>) => void; onClose: () => void }) {
  const current = (key: string) => { for (const t of texts) for (const m of t.matchAll(TOKEN)) if (m[1].toLowerCase() === key) return (m[2] ?? "").trim(); return ""; };
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(MAPPABLE.map((f) => [f.key, current(f.key)])));
  return (
    <div className="mt-4 rounded-[14px] border border-[var(--border-subtle)] bg-base-100 p-6">
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-[18px] font-medium">Map missing fields</div><p className="mt-1 text-[16px] text-base-content/60">Map default values for missing contact fields in your message. Each step has its own mapping.</p></div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-base-content/50 hover:text-base-content"><RiCloseLine size={24} /></button>
      </div>
      <div className="mt-4 space-y-3">
        {MAPPABLE.map((f) => (
          <div key={f.key} className="grid grid-cols-[160px_1fr] items-center gap-4">
            <span className="w-fit rounded-[6px] border border-[#e5484d]/40 bg-[#e5484d]/[0.05] px-2.5 py-1 font-mono text-[15px] text-[#d9343a]">[{f.label}]</span>
            <input className={`${field} h-12`} value={vals[f.key]} placeholder={f.hint} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
          </div>
        ))}
      </div>
      <p className="mt-4 flex items-start gap-2.5 rounded-[10px] bg-[#4f7cf0]/[0.07] px-4 py-3 text-[15px] text-base-content/75"><RiInformationLine size={19} className="mt-0.5 shrink-0 text-[#2f5fd8]" />These values will be used when a contact doesn&apos;t have a specific field. Leave empty to keep the default value.</p>
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="h-10 px-3 text-[16px] text-base-content/75 hover:text-base-content">Cancel</button>
        <button type="button" onClick={() => onApply(vals)} className="h-10 rounded-[8px] bg-[#f4876b] px-5 text-[16px] font-semibold text-white hover:bg-[#ee7357]">Save</button>
      </div>
    </div>
  );
}

/** Rewrites every {{key}} / {{key|old}} in `text` to carry the mapped default (or none). */
const applyMap = (text: string, map: Record<string, string>) => text.replace(TOKEN, (whole, key: string) => {
  const k = key.toLowerCase();
  if (!(k in map)) return whole;
  const v = map[k].trim().replace(/[{}|]/g, "");
  return v ? `{{${k}|${v}}}` : `{{${k}}}`;
});

export default function StepDrawer(props: Props) {
  const { step, stepNumber, delayBefore, visitBefore, likeBefore = false, channelMessageCount, workflowId, agentId, sampleTargetId, language, busy, onClose, onSave } = props;
  const type = step.step_type;
  const isEmail = type === "email";
  const isConnect = type === "connect";
  const writes = type === "message" || type === "sales_inmail" || isEmail;
  const isNew = step.id.startsWith("new-");

  const [withNote, setWithNote] = useState(!!step.connect_note);
  const [note, setNote] = useState(step.connect_note ?? "");
  const [visit, setVisit] = useState(visitBefore);
  const [like, setLike] = useState(likeBefore);
  const [fixed, setFixed] = useState(step.send_mode === "fixed");
  const [message, setMessage] = useState(step.message_body ?? "");
  const [subject, setSubject] = useState(step.email_subject ?? "");
  const [body, setBody] = useState(step.email_body ?? "");
  const [template, setTemplate] = useState<string>(step.ai_template_id ?? "");
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; channel: string }>>([]);
  const [delay, setDelay] = useState(delayBefore ?? 0);
  const [menu, setMenu] = useState<Field | null>(null);
  const [lastField, setLastField] = useState<Field>(isEmail ? "body" : isConnect ? "note" : "message");
  const [mapping, setMapping] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [previewFor, setPreviewFor] = useState(sampleTargetId ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busyAction, setBusyAction] = useState<"preview" | "generate" | "test" | null>(null);
  const [lang, setLang] = useState(language ?? null);

  useEffect(() => {
    fetch(`/api/leads?agent_id=${agentId}&limit=25&offset=0`).then((r) => r.json()).then((x) => setLeads((x?.leads ?? []).map((l: Lead) => ({ id: l.id, full_name: l.full_name, company: l.company })))).catch(() => {});
    if (writes) fetch("/api/ai-templates").then((r) => r.json()).then((x) => setTemplates(x?.templates ?? [])).catch(() => {});
    if (!language) fetch("/api/settings/account").then((r) => r.json()).then((x) => setLang(x?.profile?.language ?? "English (US)")).catch(() => {});
  }, [agentId, writes, language]);

  const refs = { note: useRef<HTMLTextAreaElement>(null), message: useRef<HTMLTextAreaElement>(null), subject: useRef<HTMLInputElement>(null), body: useRef<HTMLTextAreaElement>(null) };
  const values: Record<Field, string> = { note, message, subject, body };
  const setters: Record<Field, (v: string) => void> = { note: setNote, message: setMessage, subject: setSubject, body: setBody };
  const limits: Partial<Record<Field, number>> = { note: NOTE_MAX, message: MESSAGE_MAX };

  function pick(f: Field, key: string, fromSlash = false) {
    const el = refs[f].current;
    const { text, caret } = insertAt(el, values[f], key, fromSlash);
    const max = limits[f];
    if (max && text.length > max) { toast.message(`That would go over ${max} characters`); setMenu(null); return; }
    setters[f](text);
    setMenu(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(caret, caret); });
  }
  /** Typing "/" at the start of a word opens the variable menu. */
  function onType(f: Field, v: string, el: HTMLInputElement | HTMLTextAreaElement) {
    setters[f](v);
    const at = el.selectionStart ?? v.length;
    if (v[at - 1] === "/" && (at === 1 || /\s/.test(v[at - 2]))) { setLastField(f); setMenu(f); }
    else if (menu === f) setMenu(null);
  }

  async function ai(payload: Record<string, unknown>) {
    const r = await fetch(`/api/workflows/${workflowId}/steps/${step.id}/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.error ?? "Something went wrong");
    return x;
  }
  async function runPreview(aiMode: boolean, target = previewFor) {
    if (!target) return toast.message("Add a lead to this agent to preview");
    setBusyAction("preview");
    try {
      if (aiMode) setPreview(await ai({ action: "preview", target_id: target, ai_template_id: template || null }));
      else {
        const r = await fetch("/api/workflows/preview", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_id: target, step_type: isConnect ? "message" : type, ai_enabled: false, message_body: isConnect ? note : message, email_subject: subject, email_body: body }) });
        const x = await r.json();
        if (!r.ok) throw new Error(x.error ?? "Could not build the preview");
        setPreview({ subject: x.subject ?? null, body: x.body ?? "" });
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not build the preview"); }
    finally { setBusyAction(null); }
  }
  async function generate() {
    setBusyAction("generate");
    try {
      const x = await ai({ action: "generate", kind: isEmail ? "email" : isConnect ? "note" : "message" });
      if (isConnect) setNote(String(x.body).slice(0, NOTE_MAX));
      else if (isEmail) { setSubject(x.subject ?? subject); setBody(x.body); } else setMessage(String(x.body).slice(0, MESSAGE_MAX));
      setPreview(null);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not write the message"); }
    finally { setBusyAction(null); }
  }
  async function testEmail() {
    if (!previewFor) return toast.message("Add a lead to this agent first");
    setBusyAction("test");
    try {
      const x = await ai({ action: "test_email", target_id: previewFor, mode: fixed ? "fixed" : "ai", subject, body, ai_template_id: template || null });
      toast.success(`Test email sent to ${x.to}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not send the test email"); }
    finally { setBusyAction(null); }
  }

  const fixedEmpty = writes && fixed && (isEmail ? !subject.trim() || !body.trim() : !message.trim());
  const noteEmpty = isConnect && withNote && !note.trim();

  function save() {
    const out: StepSave = { fields: {} };
    if (isConnect) {
      out.fields = { connect_note: withNote && note.trim() ? note : null };
      if (visit !== visitBefore) out.visitBefore = visit;
      if (like !== likeBefore) out.likeBefore = like;
    } else if (writes) {
      out.fields = !fixed ? { send_mode: "ai", ai_enabled: 1, ai_template_id: template || null }
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
  const channelTemplates = templates.filter((t) => t.channel === (isEmail ? "email" : "linkedin"));
  const leadName = (l: Lead) => [l.full_name ?? "Unknown", l.company].filter(Boolean).join(" — ");
  const gradBtn = "inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-gradient-to-r from-[#f0785a] to-[#ec4f8f] px-6 text-[17px] font-medium text-white shadow-[0_8px_20px_-10px_rgba(236,79,143,0.8)] hover:opacity-95 disabled:opacity-50";

  const toolbar = (f: Field, extra?: ReactNode) => (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-3 py-2">
      <VariableMenu open={menu === f} onToggle={() => { setLastField(f); setMenu(menu === f ? null : f); }} onPick={(k) => pick(f, k)} />
      <span className="text-[15.5px] text-base-content/45">or type / in the {f === "note" ? "note" : isEmail ? "subject or body" : "message"}</span>
      <span className="ml-auto">{extra}</span>
    </div>
  );
  const previewBlock = (show: boolean) => show && preview && (
    <div className="mt-4 rounded-[14px] border border-[var(--border-subtle)] bg-base-100">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-3 text-[16px] text-base-content/65">
        Preview as
        <select className="h-10 !w-auto max-w-[360px] rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3 text-[15.5px] text-base-content" value={previewFor}
          onChange={(e) => { setPreviewFor(e.target.value); void runPreview(!fixed && !isConnect, e.target.value); }}>
          {leads.map((l) => <option key={l.id} value={l.id}>{leadName(l)}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-5 py-3 text-[16px] text-base-content/70"><RiEyeLine size={19} className="text-[#2f5fd8]" /> This is how the lead will see your {isEmail ? "email" : "message"}</div>
      <div className="px-5 py-4"><PreviewBubble preview={preview} isEmail={isEmail} /></div>
    </div>
  );
  const mapLink = <button type="button" onClick={() => setMapping(true)} className="text-[16.5px] text-[#e5484d] hover:underline">Map missing fields</button>;
  const mapPanel = mapping && (
    <MapMissing texts={[note, message, subject, body]} onClose={() => setMapping(false)}
      onApply={(m) => { setNote(applyMap(note, m)); setMessage(applyMap(message, m)); setSubject(applyMap(subject, m)); setBody(applyMap(body, m)); setMapping(false); setPreview(null); toast.success("Defaults applied to this step"); }} />
  );

  const aiCard = (
    <RadioCard on={!fixed} onSelect={() => { setFixed(false); setPreview(null); }} badge="Recommended" highlight
      title={<span className="inline-flex items-center gap-1.5">AI-powered {kind}{isEmail ? " Email" : ""}<RiStarLine size={19} className="text-[#e8a51a]" /></span>}
      subtitle={`Your AI writes a unique ${isEmail ? "email" : "first message"} for every lead, using their profile, company, and detected buying signals.`}>
      <div className="rounded-[14px] border border-[#f0785a]/15 bg-base-100/80 p-6">
        <div className="text-[17.5px] text-base-content">How it works</div>
        <ul className="mt-2.5 list-disc space-y-1.5 pl-6 text-[16.5px] text-base-content/80">
          <li>AI analyzes the lead (profile, company, signals)</li>
          <li>AI generates a personalized {isEmail ? "email" : kind.toLowerCase()} in real time</li>
          <li>You can preview &amp; edit before it&apos;s sent (in the Copilot)</li>
        </ul>
        <div className="mt-6 flex items-center gap-2.5 text-[17px] text-base-content"><RiPaletteLine size={20} className="text-[#f0785a]" /> Use a template</div>
        <div className="mt-2">
          <SearchSelect label="Template" value={template} placeholder="None — let Kairo write" searchable={channelTemplates.length > 6}
            options={[{ value: "", label: "Automatic (your workspace's template, if any)" }, { value: "none", label: "None — let Kairo write" }, ...channelTemplates.map((t) => ({ value: t.id, label: t.name }))]}
            onChange={(v) => { setTemplate(v); setPreview(null); }} />
        </div>
        <p className="mt-1.5 text-[15px] text-base-content/55">Choose a template to guide the AI&apos;s writing style, or let it be fully AI-generated.</p>
        <div className={`mt-6 grid gap-3 ${isEmail ? "sm:grid-cols-[1.2fr_1fr]" : "justify-items-center"}`}>
          <button type="button" className={gradBtn} disabled={busyAction !== null || isNew || !previewFor} onClick={() => runPreview(true)}>
            {busyAction === "preview" && <RiLoader4Line size={18} className="animate-spin" />} Generate preview for a sample lead
          </button>
          {isEmail && (
            <button type="button" disabled={busyAction !== null || isNew || !previewFor} onClick={testEmail}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-base-100 text-[17px] hover:bg-base-200 disabled:opacity-50">
              {busyAction === "test" ? <RiLoader4Line size={18} className="animate-spin" /> : <RiPlayLine size={19} />} Send test email
            </button>
          )}
        </div>
        {isNew && <p className="mt-2 text-center text-[15px] text-base-content/50">Save changes to the sequence first, then preview this step.</p>}
        {!fixed && previewBlock(true)}
        <p className="mt-5 flex items-start gap-2.5 text-[15.5px] text-base-content/70">
          <RiInformationLine size={19} className="mt-0.5 shrink-0 text-[#e5484d]" />
          <span>The AI {isEmail ? "email" : "message"} will be written in <b className="font-medium text-[#e5484d]">{lang ?? "English (US)"}</b>. Customize your AI {isEmail ? "email" : "message"} templates in{" "}
            <Link href="/settings?tab=templates" className="text-[#e5484d] underline underline-offset-2">Settings → AI Outreach Templates</Link></span>
        </p>
      </div>
    </RadioCard>
  );

  const fixedCard = (
    <RadioCard on={fixed} onSelect={() => { setFixed(true); setPreview(null); }}
      title={isEmail ? "Same email for everyone" : "Same message for everyone"} subtitle={`Use variables to craft your ${isEmail ? "email" : "message"}`}>
      <div className="space-y-4">
        {isEmail && (
          <label className="block space-y-2">
            <span className="text-[17px] text-base-content">Subject</span>
            <input ref={refs.subject} className={`${field} h-12`} value={subject} onFocus={() => setLastField("subject")} onChange={(e) => onType("subject", e.target.value, e.target)} />
          </label>
        )}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[17px] text-base-content">{isEmail ? "Email Body" : "Message Content"}</span>
            <button type="button" onClick={generate} disabled={busyAction !== null} className="inline-flex items-center gap-2 text-[16.5px] text-[#e5484d] hover:underline disabled:opacity-60">
              {busyAction === "generate" ? <><RiLoader4Line size={19} className="animate-spin" /> Generating…</> : <><RiMagicLine size={20} /> Generate with AI</>}
            </button>
          </div>
          <TokenArea inputRef={isEmail ? refs.body : refs.message} rows={isEmail ? 9 : 7} maxLength={isEmail ? undefined : MESSAGE_MAX} placeholder={isEmail ? "Write your email…" : ""}
            value={isEmail ? body : message} onFocus={() => setLastField(isEmail ? "body" : "message")} onChange={(v, el) => onType(isEmail ? "body" : "message", v, el)} />
          {toolbar(isEmail ? (lastField === "subject" ? "subject" : "body") : "message", isEmail ? mapLink : <Counter n={message.length} max={MESSAGE_MAX} />)}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-base-100 px-4 text-[16px] text-base-content/80 hover:bg-base-200 disabled:opacity-50"
            disabled={busyAction !== null || !previewFor} onClick={() => (preview ? setPreview(null) : runPreview(false))}>
            {busyAction === "preview" ? <RiLoader4Line size={18} className="animate-spin" /> : <RiEyeLine size={19} />} {preview ? "Hide preview" : "Preview"}
          </button>
          {isEmail && (
            <button type="button" disabled={busyAction !== null || isNew || !previewFor || fixedEmpty} onClick={testEmail}
              className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-base-100 px-4 text-[16px] text-base-content/80 hover:bg-base-200 disabled:opacity-50">
              {busyAction === "test" ? <RiLoader4Line size={18} className="animate-spin" /> : <RiPlayLine size={19} />} Send test email
            </button>
          )}
          {!isEmail && <span className="ml-auto">{mapLink}</span>}
        </div>
        {fixed && previewBlock(true)}
        {mapPanel}
      </div>
    </RadioCard>
  );

  return (
    <SideDrawer title={title} onClose={onClose} width={1000}
      footer={<>
        {(fixedEmpty || noteEmpty) && <span className="mr-auto text-[15.5px] text-base-content/55">{noteEmpty ? "Write the note, or send the invitation without one." : "Write the text that everyone will receive."}</span>}
        <button type="button" className="h-11 px-4 text-[16.5px] text-base-content/80 hover:text-base-content" onClick={onClose}>Cancel</button>
        <button type="button" disabled={busy || fixedEmpty || noteEmpty} onClick={save}
          className="inline-flex h-12 items-center gap-2 rounded-[8px] bg-[#f4876b] px-6 text-[17px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(232,112,82,0.7)] hover:bg-[#ee7357] disabled:opacity-50">
          {busy && <RiLoader4Line size={18} className="animate-spin" />} Save Step
        </button>
      </>}>
      <div className="space-y-5 px-1 pt-2">
        <div className="caps text-[14px] text-base-content/45">Step {stepNumber}</div>

        {isConnect && (
          <>
            <RadioCard on={!withNote} onSelect={() => setWithNote(false)} title="Invitation" subtitle="Simple connection request" />
            <RadioCard on={withNote} onSelect={() => setWithNote(true)} title="Invitation + Note" subtitle="Add a personal message">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[17px] text-base-content">Invitation Note</span>
                <button type="button" onClick={generate} disabled={busyAction !== null} className="inline-flex items-center gap-2 text-[16px] text-[#e5484d] hover:underline disabled:opacity-60">
                  {busyAction === "generate" ? <><RiLoader4Line size={18} className="animate-spin" /> Generating…</> : <><RiMagicLine size={19} /> Generate with AI</>}
                </button>
              </div>
              <TokenArea inputRef={refs.note} rows={5} maxLength={NOTE_MAX} value={note} onFocus={() => setLastField("note")} onChange={(v, el) => onType("note", v, el)} />
              <div className="mt-1.5 text-right"><Counter n={note.length} max={NOTE_MAX} /></div>
              {toolbar("note", mapLink)}
              <p className="mt-4 flex items-start gap-2 text-[15.5px] text-[#e5484d]"><RiErrorWarningLine size={19} className="mt-0.5 shrink-0" />If you don&apos;t have Sales Navigator, it&apos;s not recommended to add a note because LinkedIn applies a limit of 5 notes per month!</p>
              {mapPanel}
            </RadioCard>
            <div className="space-y-6 border-t border-[var(--border-subtle)] pt-6">
              <Warmup icon={<RiUser3Line size={19} className="text-[#f0785a]" />} title="Visit profile before sending" on={visit} onToggle={() => setVisit((v) => !v)}
                text={'Your LinkedIn profile visits the lead\'s profile before the invitation is sent, so they may see you in their "Who viewed your profile" and recognize your name.'} />
              <Warmup icon={<RiThumbUpLine size={19} className="text-[#f0785a]" />} title="Like posts before sending" on={like} onToggle={() => setLike((v) => !v)}
                text="Your LinkedIn profile randomly likes 1–2 recent posts from the lead before the invitation is sent, so your name feels familiar when it arrives, random to keep it natural." />
            </div>
          </>
        )}

        {writes && <>{aiCard}{fixedCard}</>}

        {delayBefore !== null && (
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] pt-6 text-[17px] text-base-content/80">
            Wait at least
            <div className="w-44"><SearchSelect label="Wait" value={String(delay)} placeholder={delayLabel(delay)} searchable={false}
              options={delayChoices.map((sec) => ({ value: String(sec), label: delayLabel(sec) }))} onChange={(v) => setDelay(Number(v))} /></div>
            after previous step
            <Tip text="The actual timing depends on when the contact accepts the invitation and on the daily LinkedIn quotas of your account.">
              <RiInformationLine size={20} className="text-base-content/45" />
            </Tip>
          </div>
        )}
      </div>
    </SideDrawer>
  );
}

function Warmup({ icon, title, text, on, onToggle }: { icon: ReactNode; title: string; text: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <div className="flex items-center gap-1.5 text-[18px] text-base-content">{title}{icon}</div>
        <p className="mt-1 text-[16.5px] leading-relaxed text-base-content/65">{text}</p>
      </div>
      <Toggle on={on} onChange={onToggle} label={title} />
    </div>
  );
}

function PreviewBubble({ preview, isEmail }: { preview: Preview; isEmail: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <Avatar name="You" size={40} />
      <div className="min-w-0 flex-1">
        <div className="rounded-[12px] bg-[#4f7cf0]/[0.08] px-5 py-4 text-[16.5px] leading-relaxed text-base-content">
          {isEmail && preview.subject && <div className="mb-2 font-medium">{preview.subject}</div>}
          {preview.body ? <p className="whitespace-pre-wrap">{preview.body}</p> : <p className="italic text-base-content/45">(empty {isEmail ? "email" : "message"})</p>}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[14.5px] text-base-content/50">Just now <RiCheckDoubleLine size={17} className="text-[#2f5fd8]" /></div>
      </div>
    </div>
  );
}
