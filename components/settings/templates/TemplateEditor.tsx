import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  LuAlignLeft, LuChevronDown, LuChevronLeft, LuFlag, LuHistory, LuInfo, LuLoaderCircle, LuMail, LuMessageSquareMore, LuSave, LuSearch, LuSparkles, LuCheck,
} from "react-icons/lu";
import { RiLinkedinBoxFill } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { PersonAvatar } from "@/components/inbox/kit";
import TokenEditor from "@/components/settings/templates/TokenEditor";
import { visibleLength } from "@/components/settings/templates/tokens";
import type { Example } from "@/lib/ai-templates/examples";

export type Channel = "linkedin" | "email";
export type Kind = "icebreaker" | "followup" | "closing";
export interface TemplateRow { id: string; name: string; channel: Channel; kind: Kind; subject: string | null; body: string; ai_instructions: string | null; updated_at: string; agents_using?: number }
export type Examples = Record<Channel, Record<Kind, Example[]>>;
interface Contact { id: string; full_name: string | null; title: string | null; headline: string | null; company: string | null; profile_image_url?: string | null; created_at?: string }

const LIMIT = { name: 60, linkedin: 700, email: 3000, instructions: 1000 };
export const KIND_META: Record<Kind, { label: string; icon: React.ReactNode }> = {
  icebreaker: { label: "Icebreaker", icon: <LuSparkles size={18} /> },
  followup: { label: "Follow-up", icon: <LuHistory size={18} /> },
  closing: { label: "Closing", icon: <LuFlag size={18} /> },
};
const card = "rounded-[16px] border border-[var(--border-subtle)] bg-base-100";
const seg = (on: boolean) => `inline-flex h-11 items-center gap-2 rounded-[10px] px-3 text-[16px] transition-all ${on ? "bg-base-100 font-medium text-base-content shadow-[0_1px_4px_rgba(20,20,19,0.12)]" : "text-base-content/60 hover:text-base-content"}`;
const ago = (iso?: string) => { if (!iso) return ""; const h = Math.round((Date.now() - Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`)) / 3_600_000); return h < 1 ? "just now" : h < 24 ? `${h} hour${h === 1 ? "" : "s"} ago` : `${Math.round(h / 24)} days ago`; };

function ContactPicker({ value, onChange }: { value: Contact | null; onChange: (c: Contact) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<Contact[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, [ref], () => setOpen(false));
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/leads?${new URLSearchParams({ scope: "all", status: "all", sort: "newest", limit: "25", q })}`).then((r) => r.json())
        .then((d) => { const l = (d.leads ?? []) as Contact[]; setList(l); if (!value && l[0]) onChange(l[0]); }).catch(() => {});
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q, value, onChange]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`${card} flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:border-[var(--border-strong)]`}>
        {value ? <>
          <PersonAvatar name={value.full_name} photo={value.profile_image_url} size={48} />
          <span className="min-w-0 flex-1"><span className="block truncate text-[19px] font-semibold">{value.full_name}</span><span className="block truncate text-[16px] text-base-content/65">{[value.title ?? value.headline, value.company].filter(Boolean).join(" · ")}</span></span>
        </> : <span className="flex-1 text-[16px] text-base-content/50">Pick a contact to preview with</span>}
        <LuChevronDown size={22} className={`shrink-0 text-base-content/55 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="wizard-rise absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
          <div className="relative p-2"><LuSearch size={17} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-base-content/45" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts..." aria-label="Search contacts" className="h-11 w-full rounded-[8px] border border-[var(--border-strong)] bg-base-100 pl-10 pr-3 text-[16px] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]" /></div>
          <ul className="max-h-[420px] overflow-y-auto pb-1">
            {list.map((c) => {
              const on = c.id === value?.id;
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => { onChange(c); setOpen(false); }} className={`flex w-full items-center gap-4 px-5 py-3 text-left ${on ? "bg-primary/[0.08]" : "hover:bg-base-200/60"}`}>
                    <PersonAvatar name={c.full_name} photo={c.profile_image_url} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[17px] font-medium ${on ? "text-primary" : ""}`}>{c.full_name}</span>
                      <span className="block truncate text-[15px] text-base-content/65">{[c.title ?? c.headline, c.company].filter(Boolean).join(" · ")}</span>
                      {c.created_at && <span className="block text-[14px] text-base-content/45">{ago(c.created_at)}</span>}
                    </span>
                    {on && <LuCheck size={22} className="shrink-0 text-primary" />}
                  </button>
                </li>
              );
            })}
            {!list.length && <li className="px-5 py-4 text-[15px] text-base-content/50">No contacts found</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">{children}
      <span role="tooltip" className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3 py-1.5 text-[15px] text-base-content opacity-0 shadow-[var(--shadow-overlay)] transition-opacity group-hover/tip:visible group-hover/tip:opacity-100">{text}</span>
    </span>
  );
}

export default function TemplateEditor({ initial, examples, onClose, onSaved }: {
  initial: TemplateRow | null; examples: Examples; onClose: () => void; onSaved: (t: TemplateRow) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [channel, setChannel] = useState<Channel>(initial?.channel ?? "linkedin");
  const [kind, setKind] = useState<Kind>(initial?.kind ?? "icebreaker");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [instructions, setInstructions] = useState(initial?.ai_instructions ?? "");
  const [aiOpen, setAiOpen] = useState(!!initial?.ai_instructions);
  const [exOpen, setExOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState<Contact | null>(null);
  const [preview, setPreview] = useState<{ subject: string | null; body: string; key: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const exRef = useRef<HTMLDivElement>(null);
  useDismiss(exOpen, [exRef], () => setExOpen(false));

  const bodyMax = channel === "email" ? LIMIT.email : LIMIT.linkedin;
  const bodyLen = visibleLength(body);
  const key = JSON.stringify([channel, kind, subject, body, instructions, contact?.id]);
  const stale = !!preview && preview.key !== key;
  const dirty = useMemo(() => JSON.stringify([name, channel, kind, channel === "email" ? subject : "", body, instructions]) !==
    JSON.stringify([initial?.name ?? "", initial?.channel ?? "linkedin", initial?.kind ?? "icebreaker", (initial?.channel ?? "linkedin") === "email" ? initial?.subject ?? "" : "", initial?.body ?? "", initial?.ai_instructions ?? ""]),
  [name, channel, kind, subject, body, instructions, initial]);

  function switchChannel(c: Channel) {
    if (c === channel) return;
    // LinkedIn is plain text; email is HTML. Convert what's written so nothing is lost.
    if (c === "email") setBody(body ? body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("") : "");
    else setBody(body.replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim());
    setChannel(c);
  }

  function pickExample(e: Example) {
    setBody(e.body); setSubject(e.subject ?? ""); setInstructions(e.instructions); setAiOpen(true); setExOpen(false);
    if (!name.trim()) setName(`${KIND_META[kind].label} — ${e.title}`.slice(0, LIMIT.name));
  }

  async function save() {
    if (!name.trim()) return toast.error("Give the template a name");
    if (!bodyLen) return toast.error("Write the message template");
    if (bodyLen > bodyMax) return toast.error(`Keep the message under ${bodyMax} characters`);
    if (channel === "email" && !subject.trim()) return toast.error("Add a subject line");
    setBusy(true);
    try {
      const r = await fetch(initial ? `/api/ai-templates/${initial.id}` : "/api/ai-templates", {
        method: initial ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), channel, kind, subject: channel === "email" ? subject : null, body, ai_instructions: instructions.trim() || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not save the template");
      toast.success(initial ? "Template saved" : "Template created successfully");
      onSaved(d);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not save the template"); }
    finally { setBusy(false); }
  }

  async function generate() {
    if (!contact) return toast.error("Pick a contact first");
    if (!bodyLen) return toast.error("Write the template first");
    setGenerating(true);
    try {
      const r = await fetch("/api/ai-templates/preview", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, kind, subject: channel === "email" ? subject : null, body, ai_instructions: instructions || null, target_id: contact.id }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not generate the preview");
      setPreview({ ...d, key });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not generate the preview"); }
    finally { setGenerating(false); }
  }

  function back() { if (dirty && !window.confirm("Leave without saving? Your changes to this template will be lost.")) return; onClose(); }

  return (
    <div className="space-y-6">
      <div className={`${card} flex flex-wrap items-center gap-4 px-7 py-5`}>
        <button type="button" onClick={back} className="inline-flex h-11 items-center gap-1.5 rounded-[8px] pr-3 text-[17px] text-base-content/80 hover:text-base-content"><LuChevronLeft size={22} />Back</button>
        <span className="h-8 w-px bg-[var(--border-subtle)]" />
        <input value={name} maxLength={LIMIT.name} onChange={(e) => setName(e.target.value)} placeholder="Name this template" aria-label="Template name"
          className="h-12 min-w-[240px] flex-1 rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-4 text-[17px] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]" />
        <span className="text-[15px] tabular-nums text-base-content/50">{name.length} / {LIMIT.name}</span>
        <button type="button" onClick={() => void save()} disabled={busy}
          className="ml-auto inline-flex h-12 items-center gap-2 rounded-[10px] bg-primary px-6 text-[17px] font-semibold text-primary-content shadow-[0_6px_16px_-8px_var(--color-primary)] hover:bg-[var(--primary-hover)] disabled:opacity-60">
          {busy ? <LuLoaderCircle size={19} className="animate-spin" /> : <LuSave size={19} />}Save template
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <div className={`${card} flex flex-wrap items-center gap-3 px-3 py-3`}>
            <div role="tablist" aria-label="Channel" className="flex rounded-[12px] bg-base-200/60 p-1">
              <button type="button" role="tab" aria-selected={channel === "linkedin"} onClick={() => switchChannel("linkedin")} className={seg(channel === "linkedin")}><RiLinkedinBoxFill size={22} style={{ color: "#3f2bd1" }} />LinkedIn</button>
              <button type="button" role="tab" aria-selected={channel === "email"} onClick={() => switchChannel("email")} className={seg(channel === "email")}><LuMail size={20} style={{ color: "#e5484d" }} />Email</button>
            </div>
            <div role="tablist" aria-label="Step" className="flex rounded-[12px] bg-base-200/60 p-1">
              {(Object.keys(KIND_META) as Kind[]).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={seg(kind === k)}>{KIND_META[k].icon}{KIND_META[k].label}</button>
              ))}
            </div>
            <div ref={exRef} className="relative ml-auto">
              <button type="button" onClick={() => setExOpen((v) => !v)} aria-expanded={exOpen} aria-label="Start from an example" title="Start from an example"
                className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-[var(--border-strong)] bg-base-100 px-3.5 hover:bg-base-200">
                <LuSparkles size={21} /><LuChevronDown size={18} className={`transition-transform ${exOpen ? "rotate-180" : ""}`} />
              </button>
              {exOpen && (
                <div className="wizard-rise absolute right-0 top-full z-40 mt-2 w-[440px] overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
                  {examples[channel][kind].map((e) => (
                    <button key={e.title} type="button" onClick={() => pickExample(e)} className="block w-full border-b border-[var(--border-subtle)] px-5 py-3.5 text-left hover:bg-base-200/60">
                      <span className="block text-[17px] font-medium">{e.title}</span><span className="block text-[15px] text-base-content/60">{e.desc}</span>
                    </button>
                  ))}
                  <div className="bg-base-200/40 px-5 py-2.5 text-[14px] text-base-content/55">Picking an example replaces the current text.</div>
                </div>
              )}
            </div>
          </div>

          <div className={`${card} overflow-hidden`}>
            {channel === "email" && (
              <div className="border-b border-[var(--border-subtle)] px-5 py-4">
                <div className="mb-1.5 text-[14px] font-semibold tracking-[0.06em] text-base-content/50 [text-transform:uppercase]">Subject</div>
                <TokenEditor key="subject" value={subject} onChange={setSubject} singleLine placeholder="Subject line — type / for variables" />
              </div>
            )}
            <TokenEditor key={channel} value={body} onChange={setBody} rich={channel === "email"} minHeight={channel === "email" ? 320 : 380}
              placeholder={channel === "email" ? "Write your email template..." : "Hi [FirstName], ... — type / for variables"} count={{ n: bodyLen, max: bodyMax }} />
          </div>

          <div className={`${card} overflow-hidden`}>
            <button type="button" onClick={() => setAiOpen((v) => !v)} aria-expanded={aiOpen} className={`flex w-full items-center gap-3 px-6 py-4 text-left ${aiOpen ? "bg-[#fbeaf6] " : ""}`}>
              <LuSparkles size={22} style={{ color: "#b02dc9" }} />
              <span className="text-[19px] font-medium">AI instructions</span>
              <span className="text-[15px]" style={{ color: "#a01aa8" }}>Optional · {instructions.trim() ? "set — click to edit" : "not set — click to add"}</span>
              <LuChevronDown size={22} className={`ml-auto text-base-content/55 transition-transform ${aiOpen ? "rotate-180" : ""}`} style={aiOpen ? { color: "#b02dc9" } : undefined} />
            </button>
            {aiOpen && (
              <div className="wizard-rise px-5 pb-4 pt-4">
                <div className="overflow-hidden rounded-[12px] border border-[var(--border-strong)]">
                  <TokenEditor value={instructions} onChange={setInstructions} minHeight={170} placeholder="e.g. Keep it under 400 characters. Mention their recent post if relevant. Type / for variables."
                    count={{ n: visibleLength(instructions), max: LIMIT.instructions }} />
                </div>
                <div className="mt-2 text-[14px] text-base-content/55">Followed when agents write with this template, and in the preview for the selected contact.</div>
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-5 xl:sticky xl:top-4 xl:self-start">
          <ContactPicker value={contact} onChange={setContact} />
          {!generating && (!preview || stale) && (
            <div className={`${card} flex items-center gap-4 px-5 py-4`}>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stale ? "bg-warning" : "bg-base-content/25"}`} />
              <span className="min-w-0 flex-1"><span className="block text-[17px] font-medium">{stale ? "Preview out of date" : "No preview generated"}</span>
                <span className="block text-[15px] text-base-content/60">{stale ? "The template or contact changed since the last preview." : "Generate a send-like preview for this contact."}</span></span>
              <button type="button" onClick={() => void generate()} disabled={!bodyLen || !contact}
                className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-primary px-5 text-[17px] font-semibold text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-50"><LuSparkles size={19} />{stale ? "Regenerate" : "Generate"}</button>
            </div>
          )}
          <div className={`${card} min-h-[240px] px-6 py-5`}>
            {generating ? (
              <div className="flex h-[200px] flex-col items-center justify-center gap-3 text-[16px] text-base-content/55"><LuLoaderCircle size={26} className="animate-spin text-base-content/50" />Generating send-like preview...</div>
            ) : preview ? (
              <div className={stale ? "opacity-60" : ""}>
                {preview.subject && <div className="mb-4 border-b border-[var(--border-subtle)] pb-3 text-[17px] font-semibold">{preview.subject}</div>}
                <div className="space-y-4 text-[17px] leading-[1.75] text-base-content">{preview.body.split(/\n+/).filter((p) => p.trim()).map((p, i) => <div key={i}>{p}</div>)}</div>
                <div className="mt-5 flex items-start gap-2 text-[14px] text-base-content/50"><LuInfo size={16} className="mt-0.5 shrink-0" />Send-like preview for this contact — AI instructions and generative placeholders applied.</div>
              </div>
            ) : (
              <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-[16px] text-base-content/50"><LuMessageSquareMore size={34} className="text-base-content/30" />No preview yet.</div>
            )}
          </div>
          {preview && !generating && (
            <div className="flex items-center gap-2.5 px-1 text-[15px] text-base-content/55">Built from
              <Tip text="Template"><span className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--border-subtle)] bg-base-100"><LuAlignLeft size={18} /></span></Tip>
              {instructions.trim() && <>+<Tip text="AI Instructions"><span className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#f0c8f3] bg-[#fbe8fc]" style={{ color: "#b02dc9" }}><LuSparkles size={18} /></span></Tip></>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
