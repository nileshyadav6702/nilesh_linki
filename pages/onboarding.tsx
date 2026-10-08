import type { GetServerSideProps } from "next";
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { RiArrowLeftSLine, RiArrowRightSLine, RiRocket2Line } from "react-icons/ri";
import { EMPTY_ICP } from "@/components/agents/IcpEditor";
import { sourcesFor, type WizardState } from "@/components/agents/wizard/types";
import { Field, inputCls, primaryBtn, secondaryBtn, textareaCls } from "@/components/agents/ui";
import { Choice, filled, PEOPLE_EXCLUDES } from "@/components/onboarding/fields";
import { CompaniesPanel, CompanyPanel, defaultSources, ExcludePanel, GoalsPanel, LeadsPanel, RolesPanel, SignalsPanel, channelChosen, type SampleLead } from "@/components/onboarding/panels";
import { listAgents } from "@/lib/agents/store";
import type { Icp } from "@/lib/icp/schema";
import { getServerWorkspace, loginRedirect } from "@/lib/server-workspace";

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const workspace = await getServerWorkspace(req, res);
  if (!workspace) return loginRedirect(req);
  if (listAgents(workspace.workspaceId).length > 0) return { redirect: { destination: "/agents", permanent: false } };
  return { props: {} };
};

const STEPS = ["Website", "LinkedIn", "Goals", "People", "Companies", "Exclude", "Signals", "Leads"] as const;

const INITIAL: WizardState = {
  name: "", website: "", icp: EMPTY_ICP, icpId: null, sourceKind: "signals", sources: [], listIds: [], importUrl: "", minScore: 55, agentId: null,
  outreach: { build: "ai", channel: "linkedin", goal: "conversations", tone: "professional", workflow_id: "", linkedin_account_id: "", email_account_id: "", exclude_first_degree: true, mode: "copilot", booking_url: "", daily_lead_cap: 25 },
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
    language: icp.language.trim() || "English",
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

/** First-run setup: website, LinkedIn, goals, audience, signals, then the first leads. */
export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [s, setS] = useState<WizardState>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [readFor, setReadFor] = useState("");
  const [liAccountId, setLiAccountId] = useState<string | null>(null);
  const [liEmail, setLiEmail] = useState("");
  const [liPassword, setLiPassword] = useState("");
  const [liCode, setLiCode] = useState("");
  const [liStage, setLiStage] = useState<"creds" | "code" | "approve" | "cookies">("creds");
  const [liMsg, setLiMsg] = useState("");
  const [liAt, setLiAt] = useState("");
  const [liCookie, setLiCookie] = useState("");
  const [searching, setSearching] = useState(false);
  const [leads, setLeads] = useState<SampleLead[]>([]);
  const [leadNote, setLeadNote] = useState("");
  const saved = useRef({ agentId: "", campaign: false });
  const set = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));
  const siteRead = readFor !== "" && readFor === s.website.trim();
  const onIcp = (icp: Icp) => set({ icp });

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
      const icp = { ...EMPTY_ICP, ...d.icp, language: d.icp.language?.trim() || "English", exclusions: [...new Set([...PEOPLE_EXCLUDES, ...(d.icp.exclusions ?? [])])] };
      set({ icp, website: d.website_url, icpId: null });
      setReadFor(d.website_url);
      toast.success(`Read ${d.pages?.length ?? 0} page${d.pages?.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the website");
    } finally { setBusy(false); }
  }

  function markLinkedIn(id: string) {
    setLiPassword("");
    setS((prev) => ({ ...prev, outreach: { ...prev.outreach, linkedin_account_id: id } }));
  }

  async function connectLinkedIn() {
    const email = liEmail.trim();
    if (liStage === "creds" && (!email || !liPassword)) return toast.error("Enter the LinkedIn email and password");
    if (liStage === "code" && !liCode.trim()) return toast.error("Enter the verification code");
    if (liStage === "cookies" && !liAt.trim()) return toast.error("Paste the li_at cookie");
    setBusy(true);
    try {
      let id = liAccountId;
      if (!id) {
        try {
          id = (await api("/api/accounts", "POST", { name: email.split("@")[0] || "LinkedIn", email })).id as string;
        } catch (err) {
          const message = err instanceof Error ? err.message : "";
          if (!/already exists/i.test(message)) throw err;
          const rows = await api("/api/accounts", "GET") as Array<{ id: string; email?: string | null }>;
          id = rows.find((a) => (a.email ?? "").toLowerCase() === email.toLowerCase())?.id ?? null;
          if (!id) throw err;
        }
        setLiAccountId(id);
      }
      if (liStage === "cookies") {
        await api(`/api/accounts/${id}/authenticate`, "POST", { li_at: liAt.trim(), document_cookie: liCookie });
        markLinkedIn(id);
        toast.success("LinkedIn connected");
        return;
      }
      const body = liStage === "creds" ? { step: "start", email, password: liPassword } : liStage === "approve" ? { step: "await" } : { step: "verify", code: liCode.trim() };
      const data = await api(`/api/accounts/${id}/login`, "POST", body) as { status?: string; kind?: string; message?: string };
      if (data.status === "authenticated") { markLinkedIn(id); toast.success("LinkedIn connected"); }
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
    if (step === 0) {
      if (!s.website.trim()) return "Enter your website";
      if (!siteRead) return "Analyze your website before continuing";
      if (!icp.company_name.trim()) return "Company name is required";
      if (!icp.company_industry.trim()) return "Industry is required";
      if (!icp.offer.trim()) return "Company description and value proposition are required";
      if (!filled(icp.value_props).length) return "Add at least one key feature";
      if (!filled(icp.social_proof).length) return "Add at least one social proof";
      if (!icp.language.trim()) return "Choose a preferred language";
    }
    if (step === 1 && !s.outreach.linkedin_account_id) return "Connect LinkedIn before continuing";
    if (step === 2 && !filled(icp.pain_points).length) return "Add at least one customer pain point";
    if (step === 3 && !icp.personas.some((p) => p.titles.some((t) => t.trim()))) return "Add at least one role";
    if (step === 4) {
      if (!filled(icp.industries).length) return "Add at least one industry";
      if (!filled(icp.geographies).length) return "Add at least one location";
      if (!icp.company_types.length) return "Choose at least one company type";
      if (!icp.company_sizes.length) return "Choose at least one company size";
    }
    if (step === 6) {
      const useful = s.sources.some((src) => src.enabled && (["lookalike", "job_change", "funding"].includes(src.source_type) || (src.config.keywords?.length ?? 0) > 0 || (src.config.urls?.length ?? 0) > 0));
      if (!useful) return "Choose at least one signal";
    }
    return null;
  }

  function next() {
    const problem = blocker();
    if (problem) return toast.error(problem);
    if (step === 5) setS((prev) => ({ ...prev, sourceKind: "signals", sources: prev.sources.some((src) => src.enabled) ? prev.sources : defaultSources(prev.icp) }));
    if (step === 6) { setStep(7); void findLeads(); return; }
    setStep(step + 1);
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
    setSearching(true);
    setLeadNote("");
    setBusy(true);
    try {
      const agentId = await persist();
      const data = await api(`/api/agents/${agentId}/preview`, "POST") as { leads?: SampleLead[]; errors?: string[] };
      setLeads(data.leads ?? []);
      if (!data.leads?.length) setLeadNote(data.errors?.[0] || "No sample leads came back yet. Launch anyway and the agent will keep looking.");
    } catch (err) {
      setLeadNote(err instanceof Error ? err.message : "Could not search for sample leads");
    } finally { setBusy(false); setSearching(false); }
  }

  async function rejectLead(id: string) {
    if (!saved.current.agentId) return;
    const data = await api(`/api/agents/${saved.current.agentId}/preview`, "PATCH", { target_id: id, reason: "Not a fit" }) as { leads?: SampleLead[] };
    setLeads(data.leads ?? []);
  }

  async function launch() {
    setBusy(true);
    try {
      const agentId = saved.current.agentId || await persist();
      await api(`/api/agents/${agentId}`, "PATCH", { status: "active", outreach_enabled: true });
      toast.success("Your agent is finding leads. You approve each one before it is sent.");
      router.push(`/agents/${agentId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the agent");
      setBusy(false);
    }
  }

  const connectLabel = busy ? "Connecting…" : liStage === "code" ? "Verify code" : liStage === "approve" ? "I approved it" : liStage === "cookies" ? "Save session" : "Connect LinkedIn";

  return (
    <>
      <Head><title>Start your first agent — Linki</title></Head>
      <div className="min-h-screen bg-base-100">
        <header className="flex h-16 items-center justify-between px-5 sm:px-8">
          <Link href="/agents" className="flex items-center gap-2.5"><Image src="/logo_linki.svg" alt="" width={26} height={26} /><span className="font-display text-[22px]">Linki</span></Link>
          <p className="text-sm text-base-content/45">Step {step + 1} of {STEPS.length}</p>
          <button type="button" className="text-sm font-medium text-base-content/55 hover:text-base-content" onClick={() => router.push("/agents")}>Skip for now</button>
        </header>
        <main className="mx-auto max-w-[760px] px-5 pb-28 pt-4">
          <div className="mb-4 h-1 overflow-hidden rounded-full bg-base-200"><div className="h-full bg-primary transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
          <section className="rounded-[16px] border border-[var(--border-subtle)] bg-base-300 p-5 sm:p-8">
            {step === 0 && <CompanyPanel website={s.website} onWebsite={(website) => set({ website })} analyzed={siteRead} icp={s.icp} onIcp={onIcp} onAnalyzeKey={() => { if (siteRead) next(); else void readSite(); }} />}
            {step === 1 && (
              <div className="space-y-6">
                <div className="text-center"><h2 className="text-[28px] leading-[1.15]">Connect LinkedIn</h2><p className="mx-auto mt-2 max-w-md text-sm text-base-content/55">Sign in with the account this agent should use, then choose how it reaches people.</p></div>
                {s.outreach.linkedin_account_id ? <p className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-4 py-3 text-sm">LinkedIn is connected{liEmail ? ` as ${liEmail}` : ""}.</p> : liStage === "approve" ? <p className="rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-4 py-3 text-sm">{liMsg || "Approve the sign-in in the LinkedIn app, then continue."}</p> : liStage === "code" ? (
                  <Field label="Verification code"><input className={inputCls} inputMode="numeric" autoComplete="one-time-code" value={liCode} onChange={(e) => setLiCode(e.target.value)} autoFocus /></Field>
                ) : liStage === "cookies" ? (
                  <div className="space-y-3">
                    <Field label="li_at cookie"><input className={inputCls} value={liAt} onChange={(e) => setLiAt(e.target.value)} autoComplete="off" /></Field>
                    <Field label="document.cookie" hint="Optional"><textarea className={`${textareaCls} h-20 font-mono text-xs`} value={liCookie} onChange={(e) => setLiCookie(e.target.value)} /></Field>
                    <button type="button" className="text-sm text-base-content/55" onClick={() => setLiStage("creds")}>Use email and password instead</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Field label="LinkedIn email"><input className={inputCls} type="email" autoComplete="off" value={liEmail} onChange={(e) => setLiEmail(e.target.value)} autoFocus /></Field>
                    <Field label="LinkedIn password"><input className={inputCls} type="password" autoComplete="off" value={liPassword} onChange={(e) => setLiPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void connectLinkedIn(); } }} /></Field>
                    <button type="button" className="text-sm text-base-content/55" onClick={() => setLiStage("cookies")}>Paste a session cookie instead</button>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Choice selected={s.outreach.channel !== "multi"} title="LinkedIn only" text="Connection requests and messages from this account." onClick={() => set({ outreach: { ...s.outreach, channel: "linkedin" } })} />
                  <Choice selected={s.outreach.channel === "multi"} title="Multi-channel" text="LinkedIn now. Email joins when a mailbox is connected." onClick={() => set({ outreach: { ...s.outreach, channel: "multi" } })} />
                </div>
              </div>
            )}
            {step === 2 && <GoalsPanel icp={s.icp} onIcp={onIcp} goal={s.outreach.goal} tone={s.outreach.tone} onGoal={(goal) => set({ outreach: { ...s.outreach, goal } })} onTone={(tone) => set({ outreach: { ...s.outreach, tone } })} />}
            {step === 3 && <RolesPanel icp={s.icp} onIcp={onIcp} />}
            {step === 4 && <CompaniesPanel icp={s.icp} onIcp={onIcp} />}
            {step === 5 && <ExcludePanel icp={s.icp} onIcp={onIcp} />}
            {step === 6 && <SignalsPanel icp={s.icp} sources={s.sources} onSources={(sources) => set({ sources })} onIcp={onIcp} />}
            {step === 7 && <LeadsPanel searching={searching} leads={leads} note={leadNote} onReject={(id) => void rejectLead(id)} />}
          </section>
        </main>
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border-subtle)] bg-base-100/95 backdrop-blur">
          <div className="mx-auto flex max-w-[760px] items-center justify-between px-5 py-3">
            <button type="button" className={secondaryBtn} disabled={busy || step === 0} onClick={() => setStep(step - 1)}><RiArrowLeftSLine size={18} /> Previous</button>
            {step === 0 && !siteRead
              ? <button type="button" className={primaryBtn} disabled={busy} onClick={() => void readSite()}>{busy ? "Analyzing…" : "Analyze"}</button>
              : step === 1 && !s.outreach.linkedin_account_id
                ? <button type="button" className={primaryBtn} disabled={busy} onClick={() => void connectLinkedIn()}>{connectLabel}</button>
                : step < 7
                  ? <button type="button" className={primaryBtn} disabled={busy} onClick={next}>Next step <RiArrowRightSLine size={18} /></button>
                  : <button type="button" className={primaryBtn} disabled={busy} onClick={() => void launch()}><RiRocket2Line size={16} /> {busy ? "Starting…" : "Launch agent"}</button>}
          </div>
        </div>
      </div>
    </>
  );
}
