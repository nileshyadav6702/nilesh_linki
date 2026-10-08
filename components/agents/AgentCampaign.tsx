import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RiAddLine, RiArrowDownLine, RiArrowUpLine, RiDeleteBinLine } from "react-icons/ri";
import { Card, Field, ghostBtn, inputCls, primaryBtn, secondaryBtn, textareaCls } from "@/components/agents/ui";

interface Step {
  id: string; track: "linkedin" | "email"; step_type: string; step_order: number; delay_seconds: number;
  connect_note: string | null; message_body: string | null; email_subject: string | null; email_body: string | null;
}

const LABEL: Record<string, string> = {
  visit: "Visit profile", connect: "Connection request", message: "Message",
  sales_inmail: "Sales InMail", delay: "Wait", email: "Email",
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

const daysOf = (seconds: number) => Math.max(1, Math.round((seconds || 0) / 86_400));

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
      <Card className="space-y-3">
        <div className="font-semibold">This agent has no sequence yet</div>
        <p className="text-sm text-base-content/55">Create the LinkedIn and email steps this agent will send. You can change every step here.</p>
        <button className={primaryBtn} disabled={busy} onClick={async () => { setBusy(true); await onCreate(); setBusy(false); }}>Create the sequence</button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-base-content/55">This sequence belongs to the agent. Approved leads walk these steps. Open a lead to edit what will actually be sent.</p>
      {(["linkedin", "email"] as const).map((track) => {
        const mine = (steps ?? []).filter((s) => s.track === track);
        return (
          <div key={track} className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold capitalize">{track}</h2>
              <div className="relative">
                <button className={secondaryBtn} disabled={busy || steps === null} onClick={() => setAdding(adding === track ? null : track)}><RiAddLine size={15} /> Add step</button>
                {adding === track && (
                  <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-[var(--border-subtle)] bg-base-100 py-1 shadow-[var(--shadow-overlay)]">
                    {ADD[track].map((option) => (
                      <button key={option.type} className="block w-full px-3 py-2 text-left text-sm hover:bg-base-200" onClick={() => add(track, option.type)}>{option.label}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {steps === null && <p className="text-sm text-base-content/40">Loading…</p>}
            {steps !== null && mine.length === 0 && <Card className="!py-3 text-sm text-base-content/50">No {track} steps.</Card>}
            {mine.map((step, index) => (
              <Card key={step.id} className="!py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-base-200 text-xs font-semibold">{index + 1}</span>
                    <div className="min-w-0">
                      <div className="font-medium">{LABEL[step.step_type] ?? step.step_type}</div>
                      <div className="truncate text-xs text-base-content/50">
                        {step.step_type === "delay" ? `${daysOf(step.delay_seconds)} day wait` : preview(step)}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="mr-2 text-xs tabular-nums text-base-content/45">{counts[step.id] ?? 0} here</span>
                    <button className={ghostBtn} aria-label="Move step up" disabled={index === 0 || busy} onClick={() => move(track, index, -1)}><RiArrowUpLine /></button>
                    <button className={ghostBtn} aria-label="Move step down" disabled={index === mine.length - 1 || busy} onClick={() => move(track, index, 1)}><RiArrowDownLine /></button>
                    {step.step_type !== "visit" && <button className={secondaryBtn} onClick={() => setEditing(editing === step.id ? null : step.id)}>Edit</button>}
                    <button className={ghostBtn} aria-label="Remove step" disabled={busy} onClick={() => replace((steps ?? []).filter((s) => s.id !== step.id))}><RiDeleteBinLine /></button>
                  </div>
                </div>
                {editing === step.id && <StepForm step={step} busy={busy} onCancel={() => setEditing(null)} onSave={(patch) => saveStep(step, patch)} />}
              </Card>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function preview(step: Step): string {
  if (step.step_type === "email") return step.email_subject || "Subject written per lead";
  if (step.step_type === "connect") return step.connect_note || "Invitation without a note";
  if (step.step_type === "message" || step.step_type === "sales_inmail") return step.message_body || "Written per lead";
  return "";
}

function StepForm({ step, busy, onCancel, onSave }: { step: Step; busy: boolean; onCancel: () => void; onSave: (patch: Record<string, unknown>) => void }) {
  const [days, setDays] = useState(daysOf(step.delay_seconds));
  const [note, setNote] = useState(step.connect_note ?? "");
  const [body, setBody] = useState(step.step_type === "email" ? (step.email_body ?? "") : (step.message_body ?? ""));
  const [subject, setSubject] = useState(step.email_subject ?? "");
  return (
    <div className="mt-3 space-y-3 border-t border-[var(--border-subtle)] pt-3">
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
