import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  RiAddLine, RiArrowDownLine, RiArrowUpLine, RiCheckboxCircleLine, RiDeleteBinLine, RiEyeLine, RiFilter3Line,
  RiFocus3Line, RiGroupLine, RiLinkedinBoxFill, RiMailLine, RiMailSendLine, RiPencilLine, RiSparkling2Line,
  RiTimeLine, RiUserAddLine,
} from "react-icons/ri";
import { Field, ghostBtn, IconTile, inputCls, Panel, Pill, primaryBtn, secondaryBtn, textareaCls, type Tone } from "@/components/agents/ui";

interface Step {
  id: string; track: "linkedin" | "email"; step_type: string; step_order: number; delay_seconds: number;
  connect_note: string | null; message_body: string | null; email_subject: string | null; email_body: string | null;
}

const LABEL: Record<string, string> = {
  visit: "Visit profile", connect: "Send invitation", message: "Send LinkedIn message",
  sales_inmail: "Send Sales InMail", delay: "Wait", email: "Send email",
};
const ADD: Record<"linkedin" | "email", Array<{ type: string; label: string }>> = {
  linkedin: [
    { type: "connect", label: "Connection request" },
    { type: "message", label: "Message" },
    { type: "visit", label: "Visit profile" },
    { type: "sales_inmail", label: "Sales InMail" },
    { type: "delay", label: "Wait" },
  ],
  email: [
    { type: "email", label: "Email" },
    { type: "delay", label: "Wait" },
  ],
};
const STEP_ICON: Record<string, { icon: ReactNode; tone: Tone }> = {
  connect: { icon: <RiUserAddLine size={18} />, tone: "linkedin" },
  message: { icon: <RiLinkedinBoxFill size={18} />, tone: "linkedin" },
  sales_inmail: { icon: <RiMailSendLine size={18} />, tone: "linkedin" },
  visit: { icon: <RiEyeLine size={18} />, tone: "amber" },
  email: { icon: <RiMailLine size={18} />, tone: "coral" },
};
const TRACK_TITLE = { linkedin: "LinkedIn", email: "Email" } as const;

const daysOf = (seconds: number) => Math.max(1, Math.round((seconds || 0) / 86_400));
/** Hairline-colored dot grid behind the timeline. */
const DOTS = { backgroundImage: "radial-gradient(var(--border-subtle) 1px, transparent 1px)", backgroundSize: "16px 16px" };

/** The agent's sequence. Steps are the same rows the sender already runs. */
export default function AgentCampaign({ workflowId, counts, onChanged, onCreate }: {
  workflowId: string | null; counts: Record<string, number>; onChanged: () => void; onCreate: () => Promise<void>;
}) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<"linkedin" | "email" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!workflowId) { setSteps([]); return; }
    fetch(`/api/workflows/${workflowId}/steps`).then((r) => r.json()).then((rows: Step[]) => setSteps(rows)).catch(() => setSteps([]));
  }, [workflowId]);
  useEffect(() => { load(); }, [load]);

  async function saveStep(step: Step, patch: Record<string, unknown>) {
    setBusy(true);
    const r = await fetch(`/api/workflows/${workflowId}/steps/${step.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    setBusy(false);
    if (!r.ok) return toast.error("Could not save this step");
    toast.success("Step saved");
    setEditing(null);
    load();
    onChanged();
  }

  async function replace(next: Step[]) {
    setBusy(true);
    const r = await fetch(`/api/workflows/${workflowId}/steps`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steps: next }) });
    setBusy(false);
    if (!r.ok) return toast.error("Could not update the sequence");
    load();
    onChanged();
  }

  async function add(track: "linkedin" | "email", stepType: string) {
    setAdding(null);
    setBusy(true);
    const r = await fetch(`/api/workflows/${workflowId}/steps`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track, step_type: stepType, delay_seconds: stepType === "delay" ? 86_400 : 0 }),
    });
    setBusy(false);
    if (!r.ok) return toast.error("Could not add the step");
    toast.success("Step added");
    load();
    onChanged();
  }

  function move(track: "linkedin" | "email", index: number, dir: -1 | 1) {
    if (!steps) return;
    const mine = steps.filter((s) => s.track === track);
    const other = steps.filter((s) => s.track !== track);
    const j = index + dir;
    if (j < 0 || j >= mine.length) return;
    const swapped = [...mine];
    [swapped[index], swapped[j]] = [swapped[j], swapped[index]];
    replace([...other, ...swapped]);
  }

  if (!workflowId) {
    return (
      <Panel className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <IconTile icon={<RiFocus3Line size={22} />} size={48} />
        <div className="font-display text-[22px] leading-tight">This agent has no sequence yet</div>
        <p className="max-w-md text-sm text-base-content/55">Create the LinkedIn and email steps this agent will send. You can change every step here.</p>
        <button className={primaryBtn} disabled={busy} onClick={async () => { setBusy(true); await onCreate(); setBusy(false); }}><RiAddLine size={16} /> Create the sequence</button>
      </Panel>
    );
  }

  const actionSteps = (steps ?? []).filter((s) => s.step_type !== "delay");
  const inSequence = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <Panel className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-70" style={DOTS} aria-hidden="true" />
      <div className="relative mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="coral"><span className="h-1.5 w-1.5 rounded-full bg-current" />{actionSteps.length} step{actionSteps.length === 1 ? "" : "s"}</Pill>
          <Pill><RiGroupLine size={12} />{inSequence} in sequence</Pill>
          <span className="ml-auto text-xs text-base-content/45">Approved leads walk these steps. Open a lead to edit what will actually be sent.</span>
        </div>

        <div className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-5">
          <div className="flex items-start gap-3">
            <IconTile icon={<RiFilter3Line size={18} />} tone="teal" />
            <div className="min-w-0">
              <div className="font-medium text-base-content">Lead sources</div>
              <p className="mt-0.5 text-sm text-base-content/55">This agent continuously finds qualified leads and adds them to the campaign.</p>
              <Pill tone="coral" className="mt-3"><RiFocus3Line size={12} /> High-intent signals</Pill>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center text-xs text-base-content/45">Qualified leads enter campaign<RiArrowDownLine size={14} className="mt-1" /></div>

        {steps === null && <p className="text-center text-sm text-base-content/40">Loading…</p>}
        {steps !== null && (["linkedin", "email"] as const).map((track) => {
          const mine = steps.filter((s) => s.track === track);
          let n = 0;
          return (
            <section key={track} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-base-content">
                  {track === "linkedin" ? <RiLinkedinBoxFill className="text-[#0a66c2]" size={16} /> : <RiMailLine className="text-primary" size={16} />}
                  {TRACK_TITLE[track]} steps
                </h3>
                <div className="relative">
                  <button className={`${secondaryBtn} !h-9`} disabled={busy} onClick={() => setAdding(adding === track ? null : track)}><RiAddLine size={15} /> Add step</button>
                  {adding === track && (
                    <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-[var(--border-subtle)] bg-base-100 py-1 shadow-[var(--shadow-overlay)]">
                      {ADD[track].map((option) => (
                        <button key={option.type} className="block w-full px-3 py-2 text-left text-sm hover:bg-base-200" onClick={() => add(track, option.type)}>{option.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {mine.length === 0 && <div className="rounded-[12px] border border-dashed border-[var(--border-subtle)] bg-base-100/70 px-4 py-6 text-center text-sm text-base-content/50">No {TRACK_TITLE[track]} steps yet.</div>}
              <ol className="relative space-y-4">
                {mine.length > 0 && <span className="absolute bottom-4 left-[15px] top-4 w-px bg-[var(--border-subtle)]" aria-hidden="true" />}
                {mine.map((step, index) => {
                  const controls = (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button className={ghostBtn} aria-label="Move step up" disabled={index === 0 || busy} onClick={() => move(track, index, -1)}><RiArrowUpLine /></button>
                      <button className={ghostBtn} aria-label="Move step down" disabled={index === mine.length - 1 || busy} onClick={() => move(track, index, 1)}><RiArrowDownLine /></button>
                      <button className={`${ghostBtn} hover:!text-error`} aria-label="Remove step" disabled={busy} onClick={() => replace(steps.filter((s) => s.id !== step.id))}><RiDeleteBinLine /></button>
                    </div>
                  );
                  if (step.step_type === "delay") {
                    return (
                      <li key={step.id} className="relative pl-11">
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" onClick={() => setEditing(editing === step.id ? null : step.id)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#e8a55a] bg-[#e8a55a]/10 px-3 py-1 text-xs font-medium text-[#b8742a]">
                            <RiTimeLine size={13} /> {daysOf(step.delay_seconds)} day(s) after
                          </button>
                          {controls}
                        </div>
                        {editing === step.id && <div className="mt-2 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-4"><StepForm step={step} busy={busy} onCancel={() => setEditing(null)} onSave={(patch) => saveStep(step, patch)} /></div>}
                      </li>
                    );
                  }
                  n += 1;
                  const look = STEP_ICON[step.step_type] ?? STEP_ICON.message;
                  return (
                    <li key={step.id} className="relative pl-11">
                      <span className="absolute left-0 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-content ring-4 ring-base-100">{n}</span>
                      <div className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <IconTile icon={look.icon} tone={look.tone} />
                            <div className="min-w-0">
                              <div className="font-medium text-base-content">{LABEL[step.step_type] ?? step.step_type}</div>
                              <div className="text-xs text-base-content/45">Step {n}</div>
                            </div>
                          </div>
                          {controls}
                        </div>
                        <StepBody step={step} />
                        <div className="mt-4 flex items-center justify-end gap-3 text-xs text-base-content/50">
                          <span className="inline-flex items-center gap-1 tabular-nums"><RiGroupLine size={13} /> {counts[step.id] ?? 0} contact(s)</span>
                          {step.step_type !== "visit" && <button className={ghostBtn} onClick={() => setEditing(editing === step.id ? null : step.id)}><RiPencilLine size={13} /> Edit</button>}
                        </div>
                        {editing === step.id && <StepForm step={step} busy={busy} onCancel={() => setEditing(null)} onSave={(patch) => saveStep(step, patch)} />}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}

        <div className="relative pl-11">
          <span className="absolute left-0 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-success text-white ring-4 ring-base-100"><RiCheckboxCircleLine size={18} /></span>
          <div className="flex items-center gap-3 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-4">
            <IconTile icon={<RiCheckboxCircleLine size={18} />} tone="success" size={36} />
            <div>
              <div className="font-medium text-base-content">Campaign complete</div>
              <div className="text-xs text-base-content/50">Leads finish here once every step has run.</div>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** What the step sends: the fixed text when there is one, otherwise the per-lead AI draft. */
function StepBody({ step }: { step: Step }) {
  if (step.step_type === "visit") {
    return <p className="mt-4 rounded-[10px] bg-base-200 px-4 py-3 text-sm text-base-content/60">Automatically visits the contact&apos;s LinkedIn profile.</p>;
  }
  const fixed = step.step_type === "email" ? step.email_body : step.step_type === "connect" ? step.connect_note : step.message_body;
  if (step.step_type === "connect" && !fixed) {
    return <p className="mt-4 rounded-[10px] bg-base-200 px-4 py-3 text-sm italic text-base-content/60">Invitation without a note</p>;
  }
  if (fixed) {
    return (
      <div className="mt-4 rounded-[10px] bg-base-200 px-4 py-3 text-sm text-base-content/70">
        {step.step_type === "email" && step.email_subject && <div className="mb-1 font-medium text-base-content">{step.email_subject}</div>}
        <p className="line-clamp-3 whitespace-pre-wrap">{fixed}</p>
        <div className="mt-2 text-[11px] text-base-content/45">Used when a lead has no approved draft</div>
      </div>
    );
  }
  return (
    <div className="mt-4 flex items-center gap-3 rounded-[10px] bg-base-200 px-4 py-3">
      <IconTile icon={<RiSparkling2Line size={15} />} size={32} />
      <div className="min-w-0">
        <div className="text-sm font-medium text-base-content">AI {step.step_type === "email" ? "email" : "message"}</div>
        <div className="text-xs text-base-content/50">Personalized for each contact</div>
      </div>
    </div>
  );
}

function StepForm({ step, busy, onCancel, onSave }: { step: Step; busy: boolean; onCancel: () => void; onSave: (patch: Record<string, unknown>) => void }) {
  const [days, setDays] = useState(daysOf(step.delay_seconds));
  const [note, setNote] = useState(step.connect_note ?? "");
  const [body, setBody] = useState(step.step_type === "email" ? (step.email_body ?? "") : (step.message_body ?? ""));
  const [subject, setSubject] = useState(step.email_subject ?? "");
  return (
    <div className={`space-y-3 ${step.step_type === "delay" ? "" : "mt-4 border-t border-[var(--border-subtle)] pt-4"}`}>
      {step.step_type === "delay" && <Field label="Days to wait"><input type="number" min={1} max={60} className={inputCls} value={days} onChange={(e) => setDays(Number(e.target.value))} /></Field>}
      {step.step_type === "connect" && <Field label="Invitation note" hint="Leave empty to send without a note."><textarea className={textareaCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
      {step.step_type === "email" && <Field label="Subject"><input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
      {(step.step_type === "message" || step.step_type === "sales_inmail" || step.step_type === "email") && (
        <Field label={step.step_type === "email" ? "Body" : "Message"} hint="Used when a lead has no approved draft."><textarea className={textareaCls} rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      )}
      <div className="flex gap-2">
        <button className={primaryBtn} disabled={busy} onClick={() => onSave(step.step_type === "delay" ? { delay_seconds: Math.max(1, days) * 86_400 } : step.step_type === "connect" ? { connect_note: note || null } : step.step_type === "email" ? { email_subject: subject, email_body: body } : { message_body: body })}>Save step</button>
        <button className={secondaryBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
