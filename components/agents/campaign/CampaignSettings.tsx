import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { SiGmail } from "react-icons/si";
import { RiCheckLine, RiSettings3Line } from "react-icons/ri";
import { SideDrawer } from "@/components/agents/campaign/kit";
import { inputCls, Toggle } from "@/components/agents/ui";

const GOALS = [
  { value: "conversations", title: "Start conversations", sub: "Warm prospects" },
  { value: "meetings", title: "Book sales calls", sub: "Qualified demos" },
] as const;
const TONES = [
  { value: "professional", label: "Professional" },
  { value: "conversational", label: "Conversational" },
  { value: "direct", label: "Direct" },
] as const;

/** Days to wait for an invitation before falling back to email, when turned on without a value. */
const DEFAULT_FALLBACK_DAYS = 7;

export interface CampaignSettingsInitial {
  goal: string; tone: string; exclude_first_degree: number; language?: string | null; split_messages?: number;
}

function Caption({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <div className="caps text-[15.5px] text-base-content/55">{title}</div>
      {sub && <div className="mt-1 text-[16px] text-base-content/60">{sub}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid items-center gap-3 sm:grid-cols-[230px_1fr]">
      <div className="text-[18px] text-base-content">{label}</div>
      {children}
    </div>
  );
}

function Card({ title, badge, sub, right, children }: { title: string; badge?: ReactNode; sub: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-[var(--border-subtle)] bg-base-100 px-6 py-5">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3 text-[18.5px] text-base-content">{title}{badge}</div>
          <div className="mt-1 text-[16px] leading-snug text-base-content/60">{sub}</div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/**
 * Agent-wide campaign settings: the language, goal and tone the AI writes in, who is skipped,
 * when an unanswered invitation falls back to email, and how LinkedIn messages are sent.
 */
export default function CampaignSettings({ agentId, initial, connectStep, workflowId, hasEmailSender, onClose, onSaved }: {
  agentId: string; initial: CampaignSettingsInitial;
  /** The sequence's invitation step: its "skip after N days" is the email fallback. */
  connectStep: { id: string; skip_after_days?: number | null } | null;
  workflowId: string | null; hasEmailSender: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const [language, setLanguage] = useState(initial.language ?? "");
  const [languages, setLanguages] = useState<string[]>([]);
  const [accountLanguage, setAccountLanguage] = useState<string | null>(null);
  const [goal, setGoal] = useState(initial.goal || "conversations");
  const [tone, setTone] = useState(initial.tone || "professional");
  const [exclude, setExclude] = useState(!!initial.exclude_first_degree);
  const savedDays = connectStep?.skip_after_days ?? DEFAULT_FALLBACK_DAYS;
  const [fallbackOn, setFallbackOn] = useState(savedDays > 0);
  const [days, setDays] = useState(savedDays > 0 ? savedDays : DEFAULT_FALLBACK_DAYS);
  const [split, setSplit] = useState(!!initial.split_messages);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings/account").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setLanguages(Array.isArray(d.languages) ? d.languages : []);
      setAccountLanguage(d.profile?.language ?? null);
    }).catch(() => {});
  }, []);

  async function save() {
    if (fallbackOn && (!Number.isInteger(days) || days < 1 || days > 60)) return toast.error("Pick between 1 and 60 days for the email fallback");
    setBusy(true);
    const r = await fetch(`/api/agents/${agentId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, tone, exclude_first_degree: exclude, language: language || null, split_messages: split }),
    });
    if (!r.ok) { setBusy(false); return toast.error((await r.json().catch(() => ({}))).error ?? "Could not save settings"); }
    const nextDays = fallbackOn ? days : 0;
    if (connectStep && workflowId && nextDays !== (connectStep.skip_after_days ?? DEFAULT_FALLBACK_DAYS)) {
      const s = await fetch(`/api/workflows/${workflowId}/steps/${connectStep.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skip_after_days: nextDays }) });
      if (!s.ok) { setBusy(false); return toast.error("Could not save the email fallback"); }
    }
    setBusy(false);
    toast.success("Campaign settings saved");
    onSaved();
    onClose();
  }

  const radio = (on: boolean) => `flex h-6 w-6 items-center justify-center rounded-full border-2 ${on ? "border-[#f0785a]" : "border-base-content/25"}`;

  return (
    <SideDrawer title="Campaign settings" icon={<RiSettings3Line size={24} className="text-base-content/80" />} onClose={onClose} width={800}
      footer={<>
        <button type="button" className="h-11 px-4 text-[16.5px] text-base-content/80 hover:text-base-content" onClick={onClose}>Cancel</button>
        <button type="button" disabled={busy} onClick={save}
          className="inline-flex h-12 items-center rounded-[8px] bg-[#f4876b] px-5 text-[16.5px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(232,112,82,0.7)] hover:bg-[#ee7357] disabled:opacity-60">
          {busy ? "Saving…" : "Save settings"}
        </button>
      </>}>
      <div className="px-2">
        <section className="border-b border-[var(--border-subtle)] pb-8">
          <Caption title="Campaign AI" sub="Applies to newly generated messages only." />
          <div className="space-y-6">
            <Row label="Campaign language">
              <select className={`${inputCls} !h-12 !text-[17px] ${language ? "" : "!text-base-content/55"}`} value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Campaign language">
                <option value="">Use account language ({accountLanguage ?? "English (US)"})</option>
                {languages.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </Row>
            <Row label="Campaign goal">
              <div className="grid grid-cols-2 gap-3">
                {GOALS.map((g) => {
                  const on = goal === g.value;
                  return (
                    <button key={g.value} type="button" onClick={() => setGoal(g.value)} aria-pressed={on}
                      className={`rounded-[10px] border px-5 py-3.5 text-left transition-colors ${on ? "border-[#f0785a] bg-[#f0785a]/[0.06]" : "border-[var(--border-subtle)] bg-base-100 hover:bg-base-200/60"}`}>
                      <span className={`flex items-center gap-2 text-[17.5px] ${on ? "text-[#f0785a]" : "text-base-content"}`}>{on && <RiCheckLine size={20} />}{g.title}</span>
                      <span className="mt-0.5 block text-[15.5px] text-base-content/60">{g.sub}</span>
                    </button>
                  );
                })}
              </div>
            </Row>
            <Row label="Message tone">
              <div className="grid grid-cols-3 overflow-hidden rounded-[10px] border border-[var(--border-subtle)]">
                {TONES.map((t, i) => {
                  const on = tone === t.value;
                  return (
                    <button key={t.value} type="button" onClick={() => setTone(t.value)} aria-pressed={on}
                      className={`h-12 text-[17.5px] transition-colors ${i ? "border-l border-[var(--border-subtle)]" : ""} ${on ? "bg-[#f4876b] text-white" : "bg-base-100 text-base-content hover:bg-base-200/60"}`}>{t.label}</button>
                  );
                })}
              </div>
            </Row>
          </div>
        </section>

        <section className="border-b border-[var(--border-subtle)] py-8">
          <Caption title="Connection rules" />
          <div className="space-y-4">
            <Card title="Automatically exclude first-degree connections" sub="Skips people already in your LinkedIn network"
              right={<Toggle on={exclude} onChange={() => setExclude((v) => !v)} label="Automatically exclude first-degree connections" />} />
            <Card title="Email fallback after unanswered invitation"
              badge={<span className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#4285f4]/30 bg-[#4285f4]/[0.06] px-2.5 py-0.5 text-[15px] text-[#3b6fd8]"><SiGmail size={14} className="text-[#ea4335]" /> Email</span>}
              sub="If a contact hasn't accepted your LinkedIn invitation after a set number of days, skip LinkedIn steps and reach out by email instead.">
              {connectStep ? (
                <div className="mt-5 flex flex-wrap items-center gap-4 text-[17.5px]">
                  <button type="button" role="radio" aria-checked={!fallbackOn} onClick={() => setFallbackOn(false)} className="inline-flex items-center gap-3">
                    <span className={radio(!fallbackOn)}>{!fallbackOn && <span className="h-3 w-3 rounded-full bg-[#f0785a]" />}</span> Disabled
                  </button>
                  <button type="button" role="radio" aria-checked={fallbackOn} onClick={() => setFallbackOn(true)} className="inline-flex items-center gap-3">
                    <span className={radio(fallbackOn)}>{fallbackOn && <span className="h-3 w-3 rounded-full bg-[#f0785a]" />}</span> After
                  </button>
                  <input type="number" min={1} max={60} disabled={!fallbackOn} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Days before the email fallback"
                    className={`${inputCls} !h-12 !w-24 !text-[17px] disabled:opacity-50`} />
                  <span>days</span>
                </div>
              ) : <p className="mt-4 text-[15.5px] text-base-content/55">Add a Send Invitation step to the sequence to use this.</p>}
              {connectStep && fallbackOn && !hasEmailSender && (
                <p className="mt-3 text-[15px] text-[#b8742a]">This agent has no email sender yet. Add one in Settings so the fallback can send.</p>
              )}
            </Card>
          </div>
        </section>

        <section className="py-8">
          <Caption title="LinkedIn messages" />
          <Card title="Split messages into a conversation" sub="Sends your message as 2–4 shorter messages when it feels natural, a few seconds apart"
            right={<Toggle on={split} onChange={() => setSplit((v) => !v)} label="Split messages into a conversation" />} />
        </section>
      </div>
    </SideDrawer>
  );
}
