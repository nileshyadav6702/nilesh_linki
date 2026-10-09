import type { GetServerSideProps } from "next";
import Head from "next/head";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { EMPTY_ICP } from "@/components/agents/IcpEditor";
import { EMPTY_LOOKALIKE, sourcesFor, type WizardState } from "@/components/agents/wizard/types";
import { Field, inputCls, textareaCls } from "@/components/agents/ui";
import { filled, normalizeDraft, PEOPLE_EXCLUDES } from "@/components/onboarding/fields";
import { OnboardShell, StepFooter } from "@/components/onboarding/frame";
import { ChannelStep, channelChosen, CompanyStep, GoalsStep } from "@/components/onboarding/setup";
import { CompaniesStep, ExcludeStep, RolesStep } from "@/components/onboarding/audience";
import { CompetitorsStep, defaultSources, IntentStep, KeywordsStep, ReviewStep } from "@/components/onboarding/signals";
import { LaunchingStep, LeadsStep, SearchStep, type SampleLead } from "@/components/onboarding/preview";
import { listAgents } from "@/lib/agents/store";
import type { Icp } from "@/lib/icp/schema";
import { getServerWorkspace, loginRedirect } from "@/lib/server-workspace";

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const workspace = await getServerWorkspace(req, res);
  if (!workspace) return loginRedirect(req);
  if (listAgents(workspace.workspaceId).length > 0) return { redirect: { destination: "/agents", permanent: false } };
  return { props: {} };
};

const FLOW = [
  { phase: 0, id: "website" },
  { phase: 0, id: "channel" },
  { phase: 0, id: "linkedin" },
  { phase: 0, id: "goals" },
  { phase: 1, id: "roles" },
  { phase: 1, id: "companies" },
  { phase: 1, id: "exclude" },
  { phase: 2, id: "intent" },
  { phase: 2, id: "keywords" },
  { phase: 2, id: "competitors" },
  { phase: 2, id: "review" },
  { phase: 3, id: "search" },
  { phase: 3, id: "leads" },
  { phase: 3, id: "launching" },
] as const;

const PHASE_TOTAL = [4, 3, 4, 0];

const INITIAL: WizardState = {
  name: "", website: "", icp: EMPTY_ICP, icpId: null, sourceKind: "signals", sources: [], listIds: [], importUrl: "", minScore: 55, agentId: null,
  outreach: { build: "ai", channel: "linkedin", goal: "conversations", tone: "professional", workflow_id: "", linkedin_account_id: "", email_account_id: "", exclude_first_degree: true, mode: "copilot", booking_url: "", daily_lead_cap: 25 },
  lookalike: EMPTY_LOOKALIKE,
};

async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error ?? `Request failed (${r.status})`);
  return d;
}

function cleanIcp(icp: Icp): Icp {
  return {
    ...icp,
    language: icp.language.trim() || "English (US)",
    value_props: filled(icp.value_props).slice(0, 12),
    social_proof: filled(icp.social_proof).slice(0, 12),
    pain_points: filled(icp.pain_points).slice(0, 10),
    industries: filled(icp.industries).slice(0, 20),
    geographies: filled(icp.geographies).slice(0, 20),
    company_sizes: icp.company_sizes.slice(0, 10),
    company_types: icp.company_types.slice(0, 12),
    keywords: filled(icp.keywords).slice(0, 30),
    exclusions: filled(icp.exclusions).slice(0, 30),
    personas: icp.personas.slice(0, 8).map((p) => ({ ...p, titles: filled(p.titles).slice(0, 20) })),
  };
}

function usefulSignal(s: WizardState): boolean {
  return s.sources.some((src) => src.enabled && (["lookalike", "job_change", "funding"].includes(src.source_type) || (src.config.keywords?.length ?? 0) > 0 || (src.config.urls?.length ?? 0) > 0));
}

/** First-run setup, in the same order as the four phases: company, audience, signals, then real sample leads. */
export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [s, setS] = useState<WizardState>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [readFor, setReadFor] = useState("");
  const [suggested, setSuggested] = useState({ industries: [] as string[], locations: [] as string[] });
  const [liAccountId, setLiAccountId] = useState<string | null>(null);
  const [liEmail, setLiEmail] = useState("");
  const [liPassword, setLiPassword] = useState("");
  const [liCode, setLiCode] = useState("");
  const [liStage, setLiStage] = useState<"creds" | "code" | "approve" | "cookies">("creds");
  const [liMsg, setLiMsg] = useState("");
  const [liAt, setLiAt] = useState("");
  const [liCookie, setLiCookie] = useState("");
  const [leads, setLeads] = useState<SampleLead[]>([]);
  const [leadNote, setLeadNote] = useState("");
  const saved = useRef({ agentId: "", campaign: false });
  const set = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));
  const siteRead = readFor !== "" && readFor === s.website.trim();
  const onIcp = (icp: Icp) => set({ icp });
  const id = FLOW[step].id;

  useEffect(() => {
    setSuggested((prev) => ({
      industries: [...new Set([...prev.industries, ...s.icp.industries])],
      locations: [...new Set([...prev.locations, ...s.icp.geographies])],
    }));
  }, [s.icp.industries, s.icp.geographies]);

  useEffect(() => {
    let alive = true;
    fetch("/api/accounts").then((r) => r.json()).then((accounts) => {
      if (!alive) return;
      const rows = accounts as Array<{ id: string; email?: string | null; is_authenticated: number }>;
      const li = rows.find((a) => a.is_authenticated) ?? rows[0];
      if (!li) return;
      setLiAccountId(li.id);
      setLiEmail(li.email ?? "");
      if (li.is_authenticated) setS((prev) => ({ ...prev, outreach: { ...prev.outreach, linkedin_account_id: li.id } }));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  async function readSite() {
    const website = s.website.trim();
    if (!website) return toast.error("Enter your website");
    setBusy(true);
    try {
      const d = await api("/api/icp/draft", "POST", { website_url: website }) as { icp: Icp; website_url: string; pages: string[] };
      const icp = normalizeDraft({ ...EMPTY_ICP, ...d.icp, exclusions: [...new Set([...PEOPLE_EXCLUDES, ...(d.icp.exclusions ?? [])])] });
      set({ icp, website: d.website_url, icpId: null });
      setSuggested({ industries: icp.industries, locations: icp.geographies });
      setReadFor(d.website_url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the website");
    } finally { setBusy(false); }
  }

  function markLinkedIn(accountId: string) {
    setLiPassword("");
    setS((prev) => ({ ...prev, outreach: { ...prev.outreach, linkedin_account_id: accountId } }));
  }

  async function connectLinkedIn() {
    const email = liEmail.trim();
    if (liStage === "creds" && (!email || !liPassword)) return toast.error("Enter the LinkedIn email and password");
    if (liStage === "code" && !liCode.trim()) return toast.error("Enter the verification code");
    if (liStage === "cookies" && !liAt.trim()) return toast.error("Paste the li_at cookie");
    setBusy(true);
    try {
      let accountId = liAccountId;
      if (!accountId) {
        try {
          accountId = (await api("/api/accounts", "POST", { name: email.split("@")[0] || "LinkedIn", email })).id as string;
        } catch (err) {
          const message = err instanceof Error ? err.message : "";
          if (!/already exists/i.test(message)) throw err;
          const rows = await api("/api/accounts", "GET") as Array<{ id: string; email?: string | null }>;
          accountId = rows.find((a) => (a.email ?? "").toLowerCase() === email.toLowerCase())?.id ?? null;
          if (!accountId) throw err;
        }
        setLiAccountId(accountId);
      }
      if (liStage === "cookies") {
        await api(`/api/accounts/${accountId}/authenticate`, "POST", { li_at: liAt.trim(), document_cookie: liCookie });
        markLinkedIn(accountId);
        toast.success("LinkedIn connected");
        return;
      }
      const body = liStage === "creds" ? { step: "start", email, password: liPassword } : liStage === "approve" ? { step: "await" } : { step: "verify", code: liCode.trim() };
      const data = await api(`/api/accounts/${accountId}/login`, "POST", body) as { status?: string; kind?: string; message?: string };
      if (data.status === "authenticated") { markLinkedIn(accountId); toast.success("LinkedIn connected"); }
      else if (data.status === "challenge" && data.kind === "captcha") { toast.error(data.message ?? "LinkedIn asked for a captcha. Paste the session cookie instead."); setLiStage("cookies"); }
      else if (data.status === "challenge") {
        setLiMsg(data.message ?? "");
        if (data.kind === "app") { if (liStage === "approve") toast.error("Still waiting. Approve the request in the LinkedIn app, then try again."); setLiStage("approve"); }
        else { setLiStage("code"); setLiCode(""); }
      } else throw new Error(data.message ?? "LinkedIn login failed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not connect LinkedIn");
    } finally { setBusy(false); }
  }

  function blocker(): string | null {
    const icp = s.icp;
    if (id === "website") {
      if (!s.website.trim()) return "Enter your website";
      if (!siteRead) return "Analyze your website before continuing";
      if (!icp.company_name.trim()) return "Company name is required";
      if (!icp.company_industry.trim()) return "Industry is required";
      if (!icp.offer.trim()) return "Company description and value proposition are required";
      if (!filled(icp.value_props).length) return "Add at least one key feature";
      if (!filled(icp.social_proof).length) return "Add at least one social proof";
      if (!icp.language.trim()) return "Choose a preferred language";
    }
    if (id === "goals" && !filled(icp.pain_points).length) return "Add at least one customer pain point";
    if (id === "roles" && !icp.personas.some((p) => p.titles.some((t) => t.trim()))) return "Add at least one role";
    if (id === "review" && !usefulSignal(s)) return "Choose at least one signal before previewing leads";
    return null;
  }

  function next() {
    const problem = blocker();
    if (problem) return toast.error(problem);
    if (id === "exclude") setS((prev) => ({ ...prev, sourceKind: "signals", sources: prev.sources.some((src) => src.enabled) ? prev.sources : defaultSources(prev.icp) }));
    if (id === "review") { void findLeads(); return; }
    setStep(step + 1);
  }

  function back() {
    if (id === "leads") { setStep(FLOW.findIndex((item) => item.id === "review")); return; }
    if (step > 0) setStep(step - 1);
  }

  async function persist() {
    const icp = cleanIcp(s.icp);
    const icpId = (await api("/api/icp", "POST", { data: icp, website_url: s.website || null })).id as string;
    const o = { ...s.outreach, channel: channelChosen(s.outreach.channel) };
    const draft = { ...s, icp, sourceKind: "signals" as const, sources: s.sources.some((src) => src.enabled) ? s.sources : defaultSources(icp) };
    let agentId = saved.current.agentId;
    if (!agentId) {
      agentId = (await api("/api/agents", "POST", { name: icp.company_name.trim() || "Outreach agent", icp_id: icpId, min_score: s.minScore, mode: o.mode, linkedin_account_id: o.linkedin_account_id || null, sources: sourcesFor(draft) })).id as string;
      saved.current.agentId = agentId;
    } else {
      await api(`/api/agents/${agentId}`, "PATCH", { name: icp.company_name.trim() || "Outreach agent", icp_id: icpId, linkedin_account_id: o.linkedin_account_id || null });
      for (const old of await api(`/api/agents/${agentId}/sources`, "GET") as Array<{ id: string }>) await api(`/api/agents/${agentId}/sources?source_id=${old.id}`, "DELETE");
      for (const src of sourcesFor(draft)) await api(`/api/agents/${agentId}/sources`, "POST", src);
    }
    await api(`/api/agents/${agentId}`, "PATCH", {
      mode: o.mode, goal: o.goal, tone: o.tone, channel: o.channel, exclude_first_degree: true, daily_lead_cap: o.daily_lead_cap,
      linkedin_account_id: o.linkedin_account_id || null, email_account_id: o.channel === "linkedin" ? null : o.email_account_id || null,
      ...(saved.current.campaign ? {} : { create_default_campaign: true }),
    });
    saved.current.campaign = true;
    set({ icp, icpId, agentId });
    return agentId;
  }

  async function findLeads() {
    setStep(FLOW.findIndex((item) => item.id === "search"));
    setLeadNote("");
    setBusy(true);
    try {
      const agentId = await persist();
      const data = await api(`/api/agents/${agentId}/preview`, "POST") as { leads?: SampleLead[]; errors?: string[] };
      setLeads(data.leads ?? []);
      if (!data.leads?.length) setLeadNote(data.errors?.[0] || "No sample leads came back from this search. You can still launch, and the agent will keep looking.");
      setStep(FLOW.findIndex((item) => item.id === "leads"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not search for sample leads");
      setStep(FLOW.findIndex((item) => item.id === "review"));
    } finally { setBusy(false); }
  }

  async function rejectLead(targetId: string) {
    if (!saved.current.agentId) return;
    try {
      const data = await api(`/api/agents/${saved.current.agentId}/preview`, "PATCH", { target_id: targetId, reason: "Not a fit" }) as { leads?: SampleLead[] };
      setLeads(data.leads ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reject that lead");
    }
  }

  async function launch() {
    setStep(FLOW.findIndex((item) => item.id === "launching"));
    setBusy(true);
    try {
      const agentId = saved.current.agentId || await persist();
      const connected = !!s.outreach.linkedin_account_id;
      await api(`/api/agents/${agentId}`, "PATCH", { status: "active", outreach_enabled: connected });
      toast.success(connected ? "Your agent is live. You approve each message before it is sent." : "Your agent is live. Connect LinkedIn before it can send.");
      router.push(`/agents/${agentId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the agent");
      setStep(FLOW.findIndex((item) => item.id === "leads"));
      setBusy(false);
    }
  }

  const phase = FLOW[step].phase;
  const stepNumber = FLOW.slice(0, step + 1).filter((item) => item.phase === phase).length;
  const stepLabel = PHASE_TOTAL[phase] ? `Step ${stepNumber} of ${PHASE_TOTAL[phase]}` : null;
  const ai = (id === "website" && siteRead) || (["roles", "companies", "exclude", "intent", "keywords", "competitors", "review"] as readonly string[]).includes(id);
  const actionLabel = id === "review" ? "Confirm & preview leads" : id === "leads" ? "Launch my agent" : "Next step";
  const showFooter = id !== "search" && id !== "launching";

  return (
    <>
      <Head><title>Start your first agent — Linki</title></Head>
      <OnboardShell phase={phase} stepLabel={stepLabel} ai={ai} footer={showFooter ? (
        <StepFooter
          onBack={back}
          backDisabled={busy || step === 0}
          note={id === "linkedin" && !s.outreach.linkedin_account_id ? "Connect later" : id === "keywords" ? "No keywords tracking needed" : undefined}
          onNote={id === "linkedin" && !s.outreach.linkedin_account_id ? next : undefined}
          actionLabel={actionLabel}
          busy={busy}
          chevron={id !== "leads"}
          footnote={id === "leads" ? "None of these leads are contacted until you approve the message." : undefined}
          onAction={id === "leads" ? () => void launch() : next}
        />
      ) : undefined}>
        {id === "website" && <CompanyStep website={s.website} onWebsite={(website) => set({ website })} analyzed={siteRead} busy={busy} icp={s.icp} onIcp={onIcp} onAnalyze={() => void readSite()} />}
        {id === "channel" && <ChannelStep channel={s.outreach.channel} onChange={(channel) => set({ outreach: { ...s.outreach, channel } })} />}
        {id === "linkedin" && <LinkedInStep connected={!!s.outreach.linkedin_account_id} email={liEmail} password={liPassword} stage={liStage} code={liCode} message={liMsg} liAt={liAt} cookie={liCookie} busy={busy} onEmail={setLiEmail} onPassword={setLiPassword} onCode={setLiCode} onAt={setLiAt} onCookie={setLiCookie} onStage={setLiStage} onConnect={() => void connectLinkedIn()} />}
        {id === "goals" && <GoalsStep icp={s.icp} onIcp={onIcp} goal={s.outreach.goal} tone={s.outreach.tone} onGoal={(goal) => set({ outreach: { ...s.outreach, goal } })} onTone={(tone) => set({ outreach: { ...s.outreach, tone } })} />}
        {id === "roles" && <RolesStep icp={s.icp} onIcp={onIcp} />}
        {id === "companies" && <CompaniesStep icp={s.icp} onIcp={onIcp} industries={suggested.industries} locations={suggested.locations} />}
        {id === "exclude" && <ExcludeStep icp={s.icp} onIcp={onIcp} />}
        {id === "intent" && <IntentStep sources={s.sources} onSources={(sources) => set({ sources })} />}
        {id === "keywords" && <KeywordsStep icp={s.icp} sources={s.sources} onSources={(sources) => set({ sources })} />}
        {id === "competitors" && <CompetitorsStep icp={s.icp} sources={s.sources} onIcp={onIcp} onSources={(sources) => set({ sources })} />}
        {id === "review" && <ReviewStep icp={s.icp} onIcp={onIcp} sources={s.sources} industries={suggested.industries} locations={suggested.locations} />}
        {id === "search" && <SearchStep pending={busy} />}
        {id === "leads" && <LeadsStep leads={leads} note={leadNote} onReject={(targetId) => void rejectLead(targetId)} />}
        {id === "launching" && <LaunchingStep />}
      </OnboardShell>
    </>
  );
}

function LinkedInStep({ connected, email, password, stage, code, message, liAt, cookie, busy, onEmail, onPassword, onCode, onAt, onCookie, onStage, onConnect }: {
  connected: boolean; email: string; password: string; stage: "creds" | "code" | "approve" | "cookies"; code: string; message: string; liAt: string; cookie: string; busy: boolean;
  onEmail: (v: string) => void; onPassword: (v: string) => void; onCode: (v: string) => void; onAt: (v: string) => void; onCookie: (v: string) => void; onStage: (v: "creds" | "code" | "approve" | "cookies") => void; onConnect: () => void;
}) {
  const label = busy ? "Connecting…" : stage === "code" ? "Verify code" : stage === "approve" ? "I approved it" : stage === "cookies" ? "Save session" : "Connect LinkedIn";
  return (
    <div>
      <div className="onboard-title mb-6">
        <h2 className="text-[26px] leading-[1.2]">Automate your outreach in minutes</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-base-content/55">Connect your LinkedIn account to reach leads. You approve every message before it is sent.</p>
      </div>
      <div className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-4">
        {connected ? <p className="text-sm">LinkedIn is connected{email ? ` as ${email}` : ""}.</p> : stage === "approve" ? <p className="text-sm">{message || "Approve the sign-in in the LinkedIn app, then continue."}</p> : stage === "code" ? (
          <Field label="Verification code"><input className={inputCls} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => onCode(e.target.value)} autoFocus /></Field>
        ) : stage === "cookies" ? (
          <div className="space-y-3">
            <Field label="li_at cookie"><input className={inputCls} value={liAt} onChange={(e) => onAt(e.target.value)} autoComplete="off" /></Field>
            <Field label="document.cookie" hint="Optional"><textarea className={`${textareaCls} h-20 font-mono text-xs`} value={cookie} onChange={(e) => onCookie(e.target.value)} /></Field>
            <button type="button" className="text-sm text-base-content/55" onClick={() => onStage("creds")}>Use email and password instead</button>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="LinkedIn email"><input className={inputCls} type="email" autoComplete="off" value={email} onChange={(e) => onEmail(e.target.value)} autoFocus /></Field>
            <Field label="LinkedIn password"><input className={inputCls} type="password" autoComplete="off" value={password} onChange={(e) => onPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onConnect(); } }} /></Field>
            <button type="button" className="text-sm text-base-content/55" onClick={() => onStage("cookies")}>Paste a session cookie instead</button>
          </div>
        )}
        {!connected && <button type="button" className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[8px] bg-[#0a66c2] text-sm font-medium text-white disabled:opacity-60" disabled={busy} onClick={onConnect}>{label}</button>}
      </div>
    </div>
  );
}
