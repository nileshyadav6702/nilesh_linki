import { useEffect, useState } from "react";
import { RiInformationLine, RiLinkedinBoxLine, RiMailLine } from "react-icons/ri";
import { campaignPlan } from "@/lib/agents/campaign-plan";
import { Card, Field, inputCls } from "@/components/agents/ui";
import type { OutreachChoice, WizardState } from "@/components/agents/wizard/types";

interface Option { id: string; name?: string; email?: string; from_email?: string; is_authenticated?: number }

function Choice({ selected, onClick, title, text, badge, icon }: { selected: boolean; onClick: () => void; title: string; text: string; badge?: string; icon?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-[12px] border p-4 text-left transition-colors ${selected ? "border-primary bg-primary/10" : "border-[var(--border-subtle)] bg-base-300 hover:border-[var(--border-strong)]"}`}>
      <div className="mb-2 flex items-center justify-between">{icon ?? <span />}{badge && <span className="rounded-md bg-warning px-2 py-0.5 text-[11px] font-medium text-warning-content">{badge}</span>}</div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-base-content/55">{text}</div>
    </button>
  );
}

const LABEL: Record<string, string> = { connect: "Send invitation", message: "LinkedIn message", email: "Email", visit: "Visit profile" };

export function outreachReady(o: OutreachChoice): string | null {
  if (o.channel !== "email" && !o.linkedin_account_id) return "Choose a LinkedIn sender (or pick Emails only)";
  if (o.channel !== "linkedin" && !o.email_account_id) return "Choose an email sender (or pick LinkedIn only)";
  return null;
}

export default function OutreachStep({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const o = state.outreach;
  const put = (p: Partial<OutreachChoice>) => set({ outreach: { ...o, ...p } });
  const [accounts, setAccounts] = useState<Option[]>([]);
  const [emails, setEmails] = useState<Option[]>([]);
  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then(setAccounts).catch(() => {});
    fetch("/api/email-accounts").then((r) => r.json()).then(setEmails).catch(() => {});
  }, []);

  // Day each planned step runs, per track, to preview the generated sequence.
  const plan = (() => {
    const day = { linkedin: 0, email: 0 };
    return campaignPlan(o.channel).flatMap((s) => {
      if (s.type === "delay") { day[s.track] += Math.round((s.delay ?? 0) / 86_400); return []; }
      const ai = s.type === "message" || s.type === "email" ? (s.position === 1 ? "AI icebreaker" : s.ai?.startsWith("AI closing") ? "AI closing" : "AI follow-up") : null;
      return [{ ...s, day: day[s.track], ai }];
    }).sort((a, b) => a.day - b.day);
  })();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-[-.02em]">Tell your agent how to reach out</h2>
        <p className="mt-1 text-sm text-base-content/55">Configure your messaging strategy.</p>
      </div>
      <p className="flex items-start gap-2 rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning"><RiInformationLine size={16} className="mt-0.5 shrink-0" /><span><b>Nothing is sent without your green light.</b> At the end you can start outreach right away or keep it paused.</span></p>

      <Card className="space-y-4">
          <div className="font-semibold">How do you want to reach your prospects?</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Choice selected={o.channel === "linkedin"} onClick={() => put({ channel: "linkedin" })} icon={<RiLinkedinBoxLine size={18} />} title="LinkedIn only" text="Connection requests and messages" />
            <Choice selected={o.channel === "multi"} onClick={() => put({ channel: "multi" })} badge="Recommended" icon={<span className="flex gap-1"><RiLinkedinBoxLine size={18} /><RiMailLine size={18} /></span>} title="Multi-channel" text="LinkedIn and email for higher reply rates" />
            <Choice selected={o.channel === "email"} onClick={() => put({ channel: "email" })} icon={<RiMailLine size={18} />} title="Emails only" text="Email sequence from your mailboxes" />
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/45">Campaign goal</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice selected={o.goal === "conversations"} onClick={() => put({ goal: "conversations" })} title="Start conversations with warm prospects" text="Build relationships through personal conversations" />
              <Choice selected={o.goal === "meetings"} onClick={() => put({ goal: "meetings" })} title="Book qualified calls or demos" text="A direct approach to schedule meetings" />
            </div>
          </div>
          {o.goal === "meetings" && <Field label="Meeting link"><input className={inputCls} placeholder="https://cal.com/you/intro" value={o.booking_url} onChange={(e) => put({ booking_url: e.target.value })} /></Field>}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/45">Message tone</div>
            <div className="grid grid-cols-3 gap-2">
              {([["professional", "Professional", "Formal, polished"], ["conversational", "Conversational", "Friendly, casual"], ["direct", "Direct", "Bold, confident"]] as const).map(([v, t, d]) => (
                <Choice key={v} selected={o.tone === v} onClick={() => put({ tone: v })} title={t} text={d} />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/45">Sequence</div>
            <ol className="space-y-1.5">
              {plan.map((s, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-sm">
                  <span className="w-14 shrink-0 text-xs text-base-content/45">{s.day === 0 ? "Day 0" : `Day ${s.day}`}</span>
                  {s.track === "email" ? <RiMailLine size={14} /> : <RiLinkedinBoxLine size={14} />}
                  <span>{LABEL[s.type]}</span>
                  {s.ai && <span className="ml-auto rounded-md bg-[var(--viz-4,#7c5cff)]/10 px-2 py-0.5 text-xs text-[var(--viz-4,#7c5cff)]">{s.ai}</span>}
                </li>
              ))}
            </ol>
          </div>
      </Card>

      <Card className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {o.channel !== "email" && (
            <Field label="LinkedIn sender" hint="Used for discovery and outreach within its limits">
              <select className={inputCls} value={o.linkedin_account_id} onChange={(e) => put({ linkedin_account_id: e.target.value })}>
                <option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id} disabled={!a.is_authenticated}>{a.name ?? a.email}{a.is_authenticated ? "" : " (not connected)"}</option>)}
              </select>
            </Field>
          )}
          {o.channel !== "linkedin" && (
            <Field label="Email sender">
              <select className={inputCls} value={o.email_account_id} onChange={(e) => put({ email_account_id: e.target.value })}>
                <option value="">Choose…</option>{emails.map((a) => <option key={a.id} value={a.id}>{a.from_email ?? a.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="checkbox checkbox-sm mt-0.5" checked={o.exclude_first_degree} onChange={(e) => put({ exclude_first_degree: e.target.checked })} /><span><b className="font-medium">Exclude 1st-degree connections</b><span className="block text-xs text-base-content/50">Skip people you&apos;re already connected with on LinkedIn.</span></span></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="toggle toggle-sm mt-0.5" checked={o.mode === "copilot"} onChange={(e) => put({ mode: e.target.checked ? "copilot" : "autopilot" })} /><span><b className="font-medium">Review mode</b><span className="block text-xs text-base-content/50">{o.mode === "copilot" ? "You approve each lead, and edit its messages, before anything is sent." : "Autopilot: drafts send 60 minutes after they're ready unless you reject them on the lead."}</span></span></label>
        <Field label="New contacts per day"><input type="number" min={1} max={500} className={`${inputCls} w-32`} value={o.daily_lead_cap} onChange={(e) => put({ daily_lead_cap: Number(e.target.value) })} /></Field>
      </Card>
    </div>
  );
}
