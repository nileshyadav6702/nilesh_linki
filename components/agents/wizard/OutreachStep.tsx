import { useEffect, useState } from "react";
import { RiInformationLine, RiLinkedinBoxLine, RiMailLine, RiSparkling2Line } from "react-icons/ri";
import { campaignPlan } from "@/lib/agents/campaign-plan";
import { Callout, Field, IconTile, inputCls, Panel, Pill, Toggle } from "@/components/agents/ui";
import { Caps, OptionCard, RadioCard, RecommendedBadge, StepHeading, StepSheet } from "@/components/agents/wizard/kit";
import type { OutreachChoice, WizardState } from "@/components/agents/wizard/types";

interface Option { id: string; name?: string; email?: string; from_email?: string; is_authenticated?: number }

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
    <StepSheet>
      <StepHeading title="Tell your agent how to reach out" subtitle="Configure your messaging strategy." />
      <Callout icon={<RiInformationLine size={16} />} title="Nothing is sent without your green light.">At the end you can start outreach right away or keep it paused.</Callout>

      <section className="space-y-3">
        <div><div className="text-[15px] font-semibold">How do you want to reach your prospects?</div><div className="text-sm text-base-content/55">We&apos;ll craft your AI sequence for the channel(s) you pick.</div></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <OptionCard selected={o.channel === "linkedin"} onClick={() => put({ channel: "linkedin" })} icon={<IconTile icon={<RiLinkedinBoxLine size={18} />} tone="linkedin" size={36} />} title="LinkedIn only" text="Connection requests and messages" />
          <OptionCard selected={o.channel === "multi"} onClick={() => put({ channel: "multi" })} badge={<RecommendedBadge />} icon={<IconTile icon={<span className="flex gap-0.5"><RiLinkedinBoxLine size={16} /><RiMailLine size={16} /></span>} tone="coral" size={36} />} title="Multi-channel" text="LinkedIn and email for higher reply rates" />
          <OptionCard selected={o.channel === "email"} onClick={() => put({ channel: "email" })} icon={<IconTile icon={<RiMailLine size={18} />} tone="amber" size={36} />} title="Emails only" text="Email sequence from your mailboxes" />
        </div>
      </section>

      <Panel className="space-y-3 p-5">
        <Caps>Campaign goal</Caps>
        <div role="radiogroup" className="space-y-2">
          <RadioCard selected={o.goal === "conversations"} onClick={() => put({ goal: "conversations" })} title="Start conversations with warm prospects" text="Build relationships through personal conversations" />
          <RadioCard selected={o.goal === "meetings"} onClick={() => put({ goal: "meetings" })} title="Book qualified calls or demos" text="A direct approach to schedule meetings" />
        </div>
        {o.goal === "meetings" && <Field label="Meeting link"><input className={inputCls} placeholder="https://cal.com/you/intro" value={o.booking_url} onChange={(e) => put({ booking_url: e.target.value })} /></Field>}
      </Panel>

      <Panel className="space-y-3 p-5">
        <Caps>Message tone</Caps>
        <div className="grid grid-cols-3 gap-2">
          {([["professional", "Professional", "Formal, polished"], ["conversational", "Conversational", "Friendly, casual"], ["direct", "Direct", "Bold, confident"]] as const).map(([v, t, d]) => (
            <button key={v} type="button" aria-pressed={o.tone === v} onClick={() => put({ tone: v })} className={`rounded-[10px] border px-3 py-3 text-center transition-colors ${o.tone === v ? "border-primary/60 bg-primary/5" : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"}`}>
              <div className="text-sm font-semibold">{t}</div><div className="text-xs text-base-content/50">{d}</div>
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="space-y-3 p-5">
        <Caps>Sequence</Caps>
        <ol className="space-y-1.5">
          {plan.map((s, i) => (
            <li key={i} className="flex items-center gap-3 rounded-[10px] border border-[var(--border-subtle)] px-3 py-2 text-sm">
              <span className="w-14 shrink-0 text-xs tabular-nums text-base-content/45">Day {s.day}</span>
              <IconTile icon={s.track === "email" ? <RiMailLine size={14} /> : <RiLinkedinBoxLine size={14} />} tone={s.track === "email" ? "amber" : "linkedin"} size={32} />
              <span>{LABEL[s.type]}</span>
              {s.ai && <span className="ml-auto"><Pill tone="coral"><RiSparkling2Line size={12} /> {s.ai}</Pill></span>}
            </li>
          ))}
        </ol>
      </Panel>

      {o.channel !== "email" && (
        <Panel className="space-y-3 p-5">
          <div><Caps>LinkedIn sender</Caps><p className="mt-1 text-sm text-base-content/55">Used for discovery and outreach within its limits.</p></div>
          <select className={`${inputCls} sm:max-w-sm`} value={o.linkedin_account_id} onChange={(e) => put({ linkedin_account_id: e.target.value })} aria-label="LinkedIn sender">
            <option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id} disabled={!a.is_authenticated}>{a.name ?? a.email}{a.is_authenticated ? "" : " (not connected)"}</option>)}
          </select>
        </Panel>
      )}
      {o.channel !== "linkedin" && (
        <Panel className="space-y-3 p-5">
          <div><Caps>Email sender</Caps><p className="mt-1 text-sm text-base-content/55">Choose which email account sends the email steps.</p></div>
          <select className={inputCls} value={o.email_account_id} onChange={(e) => put({ email_account_id: e.target.value })} aria-label="Email sender">
            <option value="">Choose…</option>{emails.map((a) => <option key={a.id} value={a.id}>{a.from_email ?? a.name}</option>)}
          </select>
        </Panel>
      )}

      <Panel className="flex items-start gap-3 p-5 text-sm">
        <input type="checkbox" className="checkbox checkbox-sm checkbox-primary mt-0.5" checked={o.exclude_first_degree} onChange={(e) => put({ exclude_first_degree: e.target.checked })} aria-label="Exclude 1st-degree connections" />
        <span><b className="font-medium">Exclude 1st-degree connections</b><span className="block text-xs text-base-content/50">Skip people you&apos;re already connected with on LinkedIn.</span></span>
      </Panel>
      <Panel className="flex items-center justify-between gap-4 p-5 text-sm">
        <span><b className="font-medium">Review mode</b><span className="block text-xs text-base-content/50">{o.mode === "copilot" ? "You approve each lead, and edit its messages, before anything is sent." : "Autopilot: drafts send 60 minutes after they're ready unless you reject them on the lead."}</span></span>
        <Toggle label="Review mode" on={o.mode === "copilot"} onChange={() => put({ mode: o.mode === "copilot" ? "autopilot" : "copilot" })} />
      </Panel>
      <Panel className="p-5">
        <Field label="New contacts per day"><input type="number" min={1} max={500} className={`${inputCls} w-32`} value={o.daily_lead_cap} onChange={(e) => put({ daily_lead_cap: Number(e.target.value) })} /></Field>
      </Panel>
    </StepSheet>
  );
}
