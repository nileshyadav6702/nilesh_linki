import { useEffect, useState } from "react";
import {
  RiCheckLine, RiHand, RiInformationLine, RiLinkedinBoxFill, RiLockLine, RiMailLine, RiSparkling2Line, RiSparklingLine,
} from "react-icons/ri";
import AgentCampaign from "@/components/agents/AgentCampaign";
import { SearchSelect } from "@/components/agents/sources/kit";
import { Avatar, inputCls, Toggle } from "@/components/agents/ui";
import { Block, OptionCard, RadioCard, RecommendedBadge, StepHeading, StepSheet } from "@/components/agents/wizard/kit";
import type { OutreachChoice, WizardState } from "@/components/agents/wizard/types";

interface LinkedInAccount { id: string; name: string | null; email: string | null; is_authenticated: number }
interface EmailAccount { id: string; name: string | null; from_email: string | null; from_name: string | null }

/** Why the Outreach step can't continue yet, or null when it can. */
export function outreachReady(o: OutreachChoice): string | null {
  if (!o.build) return "Choose how to build your sequence";
  if (o.build === "manual") {
    if (!o.workflow_id) return "Your sequence is still being created";
    return o.linkedin_account_id || o.email_account_id ? null : "Choose a LinkedIn or email sender";
  }
  if (o.channel !== "email" && !o.linkedin_account_id) return "Choose a LinkedIn sender (or pick Emails only)";
  if (o.channel !== "linkedin" && !o.email_account_id) return "Choose an email sender (or pick LinkedIn only)";
  return null;
}

const TONES = [["professional", "Professional", "Formal, polished"], ["conversational", "Conversational", "Friendly, casual"], ["direct", "Direct", "Bold, confident"]] as const;
const iconTile = "flex h-12 w-12 items-center justify-center rounded-[12px] bg-primary/10 text-primary";

export default function OutreachStep({ state, set, onManual, onEditSources }: {
  state: WizardState; set: (p: Partial<WizardState>) => void;
  /** Creates (once) the editable default sequence for manual setup. */
  onManual: () => Promise<void>; onEditSources: () => void;
}) {
  const o = state.outreach;
  const put = (p: Partial<OutreachChoice>) => set({ outreach: { ...o, ...p } });
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [emails, setEmails] = useState<EmailAccount[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingCompany, setEditingCompany] = useState(false);
  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then((a) => setAccounts(Array.isArray(a) ? a : [])).catch(() => {});
    fetch("/api/email-accounts").then((r) => r.json()).then((e) => setEmails(Array.isArray(e) ? e : [])).catch(() => {});
  }, []);

  async function chooseManual() {
    put({ build: "manual" });
    if (o.workflow_id && o.build === "manual") return;
    setCreating(true);
    try { await onManual(); } finally { setCreating(false); }
  }

  const icp = state.icp;
  const setIcp = (p: Partial<typeof icp>) => set({ icp: { ...icp, ...p }, icpId: null });
  const manual = o.build === "manual";
  const showLinkedIn = manual ? accounts.length > 0 : o.channel !== "email";
  const showEmail = manual ? emails.length > 0 : o.channel !== "linkedin";

  return (
    <StepSheet>
      <StepHeading title="Tell your agent how to reach out" subtitle="Configure your messaging strategy now" />
      <div className="mx-auto flex max-w-[860px] items-start gap-4 rounded-[12px] bg-primary/10 px-6 py-4 text-[17px] leading-relaxed text-primary">
        <RiInformationLine size={22} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p><span className="font-semibold">Nothing is sent without your green light.</span> <span className="opacity-90">We&apos;ll prepare everything based on your setup. At the end, you can start outreach right away or keep it paused for now.</span></p>
      </div>

      <div className="space-y-8">
        <section className="space-y-4">
          <div><div className="text-[17px] font-medium">How do you want to build your sequence?</div><div className="mt-1 text-[17px] text-base-content/60">Let AI craft it for you, or design every step yourself.</div></div>
          <div className="grid gap-5 sm:grid-cols-2">
            <OptionCard selected={o.build === "ai"} onClick={() => put({ build: "ai" })} icon={<span className={iconTile}><RiSparkling2Line size={24} /></span>} corner={<RecommendedBadge />}
              title="Create with AI" text="We build your full sequence automatically: invitation, follow-ups, delays, and message drafts. You can still tweak every step." />
            <OptionCard selected={manual} onClick={() => void chooseManual()} icon={<span className={iconTile}><RiHand size={24} /></span>}
              title="Manual setup" text="You build each step yourself, with full control over the sequence. You can still write messages by hand or generate them with AI." />
          </div>
        </section>

        {o.build && (
          <div key={o.build} className="space-y-8">
            {manual ? (
              <div className="wizard-rise flex items-center gap-3 rounded-[12px] bg-[#eef0fb] px-6 py-4 text-[17px] text-[#4f5bd5]">
                <RiInformationLine size={20} className="shrink-0" /> In manual mode you&apos;ll add LinkedIn and/or Email steps yourself, no need to choose a channel upfront
              </div>
            ) : (
              <section className="wizard-rise space-y-4">
                <div><div className="text-[17px] font-medium">How do you want to reach your prospects?</div><div className="mt-1 text-[17px] text-base-content/60">We&apos;ll craft your AI sequence for the channel(s) you pick.</div></div>
                <div className="grid gap-5 sm:grid-cols-3">
                  <OptionCard selected={o.channel === "linkedin"} onClick={() => put({ channel: "linkedin" })} icon={<RiLinkedinBoxFill size={28} className="text-primary" />}
                    title="LinkedIn only" text="Focus on LinkedIn messages and connection requests." />
                  <OptionCard selected={o.channel === "multi"} onClick={() => put({ channel: "multi" })} corner={<RecommendedBadge />}
                    icon={<span className="flex gap-1.5 text-primary"><RiLinkedinBoxFill size={28} /><RiMailLine size={28} /></span>}
                    title="Multi-channel" text="Reach prospects on LinkedIn and email. Recommended for higher reply rates." />
                  <OptionCard selected={o.channel === "email"} onClick={() => put({ channel: "email" })} icon={<RiMailLine size={28} className="text-primary" />}
                    title="Emails Only" text="Send a volume of emails with unlimited mailboxes." />
                </div>
              </section>
            )}

            <section className="wizard-rise overflow-hidden rounded-[16px] border border-[var(--border-subtle)]">
              <div className="flex flex-wrap items-center gap-3 px-6 py-5">
                <span className="text-[17px] font-semibold uppercase">Company information</span>
                <span className="rounded-[6px] border border-primary/30 bg-primary/5 px-2 py-0.5 text-[14px] text-primary">Account-level</span>
                <span className="ml-auto truncate text-[17px] text-base-content/60">{[icp.company_name, icp.company_industry].filter(Boolean).join(" · ") || "Not set"}</span>
                <button type="button" onClick={() => setEditingCompany(!editingCompany)} className="text-[15px] font-medium text-primary hover:underline">{editingCompany ? "Done" : "Edit"}</button>
              </div>
              {editingCompany ? (
                <div className="wizard-rise grid gap-3 border-t border-[var(--border-subtle)] bg-primary/[0.04] px-6 py-5 sm:grid-cols-2">
                  <input className={inputCls} value={icp.company_name} onChange={(e) => setIcp({ company_name: e.target.value })} placeholder="Company name" aria-label="Company name" />
                  <input className={inputCls} value={icp.company_industry} onChange={(e) => setIcp({ company_industry: e.target.value })} placeholder="Industry" aria-label="Industry" />
                  <textarea className={`${inputCls} !h-24 py-2 sm:col-span-2`} value={icp.offer} onChange={(e) => setIcp({ offer: e.target.value })} placeholder="What you sell and the value it brings" aria-label="Offer" />
                </div>
              ) : (
                <div className="flex items-start gap-4 border-t border-[var(--border-subtle)] bg-primary/[0.06] px-6 py-4 text-[17px] leading-relaxed text-primary">
                  <RiSparklingLine size={20} className="mt-1 shrink-0" />
                  <p>{icp.offer || "Describe what you sell so your agent can write relevant messages."} You can edit them at the workspace level or just for your account.</p>
                </div>
              )}
            </section>

            <Block title="Campaign goal">
              <div role="radiogroup" aria-label="Campaign goal" className="space-y-4">
                <RadioCard selected={o.goal === "conversations"} onClick={() => put({ goal: "conversations" })} title="Start conversations with warm prospects" text="Build relationships through personalized conversations" />
                <RadioCard selected={o.goal === "meetings"} onClick={() => put({ goal: "meetings" })} title="Book qualified sales calls/demos" text="Direct approach to schedule meetings" />
              </div>
              {o.goal === "meetings" && <input className={`${inputCls} wizard-rise !h-11`} placeholder="Your meeting link, e.g. https://cal.com/you/intro" value={o.booking_url} onChange={(e) => put({ booking_url: e.target.value })} aria-label="Meeting link" />}
            </Block>

            <Block title="Message tone">
              <div role="radiogroup" aria-label="Message tone" className="grid gap-4 sm:grid-cols-3">
                {TONES.map(([v, t, d]) => (
                  <button key={v} type="button" role="radio" aria-checked={o.tone === v} onClick={() => put({ tone: v })}
                    className={`rounded-[12px] border px-4 py-5 text-center transition-all duration-200 ${o.tone === v ? "border-primary/60 bg-primary/5" : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"}`}>
                    <div className="text-[17px] font-medium">{t}</div><div className="mt-1 text-[15px] text-base-content/55">{d}</div>
                  </button>
                ))}
              </div>
            </Block>

            {manual && (
              <Block title="Outreach sequence" subtitle="Build the campaign workflow step by step.">
                {creating || !state.agentId ? (
                  <p className="py-6 text-center text-[15px] text-base-content/50">Creating your default sequence…</p>
                ) : (
                  <AgentCampaign agentId={state.agentId} workflowId={o.workflow_id || null} stats={[]} leadCount={0}
                    sources={{ count: state.sourceKind === "signals" ? state.sources.filter((s) => s.enabled).length : 1, leads: 0 }}
                    settings={{ goal: o.goal, tone: o.tone, exclude_first_degree: o.exclude_first_degree ? 1 : 0 }}
                    onChanged={() => {}} onCreate={onManual} onEditSources={onEditSources} />
                )}
              </Block>
            )}

            {showLinkedIn && (
              <Block title="LinkedIn sender" subtitle="Choose which LinkedIn account will send the messages.">
                <div className="flex items-center gap-3 rounded-[10px] bg-primary/10 px-5 py-3.5 text-[17px] text-primary"><RiLockLine size={20} /> The LinkedIn account cannot be modified once the campaign has been created.</div>
                <div className="sm:max-w-[420px]">
                  <SearchSelect label="LinkedIn sender" placeholder="Choose a LinkedIn account" searchable={accounts.length > 5} value={o.linkedin_account_id}
                    onChange={(v) => put({ linkedin_account_id: v })}
                    options={accounts.map((a) => ({
                      value: a.id, label: a.name ?? a.email ?? "LinkedIn account", disabled: !a.is_authenticated, note: a.is_authenticated ? undefined : "(not connected)",
                      lead: <Avatar name={a.name ?? a.email} size={30} />,
                      pill: a.is_authenticated ? <span className="rounded-[6px] border border-success/30 bg-success/10 px-2 py-px text-[13.5px] text-[#3a8c4f]">Connected</span> : undefined,
                    }))} />
                </div>
              </Block>
            )}

            {showEmail && (
              <Block title="Email sender" subtitle="Choose which email account will send the email steps.">
                <div className="space-y-2">
                  <div className="text-[15px] font-medium">Email account</div>
                  <SearchSelect label="Email account" placeholder="Choose an email account" searchable={emails.length > 5} value={o.email_account_id} onChange={(v) => put({ email_account_id: v })}
                    options={emails.map((e) => ({ value: e.id, label: [e.from_name ?? e.name, e.from_email].filter(Boolean).join(" - ") }))} />
                </div>
                <a href="/settings?tab=email" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 text-[15px] font-medium text-primary hover:underline"><RiMailLine size={18} /> Add Mailbox</a>
                <p className="text-[15px] text-base-content/60">You can add many mailboxes after creating the agent. Emails will be sent randomly across all connected mailboxes.</p>
              </Block>
            )}

            <label className="wizard-rise flex cursor-pointer items-start gap-4 rounded-[16px] border border-[var(--border-subtle)] px-6 py-6">
              <input type="checkbox" className="peer sr-only" checked={o.exclude_first_degree} onChange={(e) => put({ exclude_first_degree: e.target.checked })} />
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] ${o.exclude_first_degree ? "border-primary bg-primary text-primary-content" : "border-primary/50"}`}>
                {o.exclude_first_degree && <RiCheckLine size={18} />}
              </span>
              <span><span className="block text-[17px] font-medium">Automatically exclude first degree connections from your campaign</span><span className="mt-1 block text-[15px] text-base-content/60">Skip people you&apos;re already connected with on LinkedIn.</span></span>
            </label>

            <div className="wizard-rise flex items-center justify-between gap-4 rounded-[16px] border border-[var(--border-subtle)] px-6 py-6">
              <span><span className="block text-[17px] font-medium">Enable Review Mode</span><span className="mt-1 block text-[15px] text-base-content/60">Review contacts before outreach starts</span></span>
              <Toggle label="Enable Review Mode" on={o.mode === "copilot"} onChange={() => put({ mode: o.mode === "copilot" ? "autopilot" : "copilot" })} />
            </div>
          </div>
        )}
      </div>
    </StepSheet>
  );
}
