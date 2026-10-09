import Head from "next/head";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { RiArrowLeftSLine, RiArrowRightSLine, RiBroadcastLine, RiLoader4Line, RiRocket2Line } from "react-icons/ri";
import { EMPTY_ICP } from "@/components/agents/IcpEditor";
import SourcesStep, { sourcesReady } from "@/components/agents/wizard/SourcesStep";
import TargetStep from "@/components/agents/wizard/TargetStep";
import PreviewStep from "@/components/agents/wizard/PreviewStep";
import OutreachStep, { outreachReady } from "@/components/agents/wizard/OutreachStep";
import ReviewStep from "@/components/agents/wizard/ReviewStep";
import { EMPTY_LOOKALIKE, sourcesFor, type LookalikeState, type WizardState } from "@/components/agents/wizard/types";
import { ErrorDialog, Stepper } from "@/components/agents/wizard/kit";
import { scopeTitles, type LookalikeProfile, type LookalikeScope } from "@/lib/agents/lookalike-rules";
import type { Icp } from "@/lib/icp/schema";
import { roleTitles, setRoles, sizePreset } from "@/lib/icp/targeting";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

const STEPS = ["Sources", "Target", "Preview", "Outreach", "Review"] as const;

const INITIAL: WizardState = {
  name: "", website: "", icp: EMPTY_ICP, icpId: null, sourceKind: null, sources: [], listIds: [], importUrl: "", minScore: 55, agentId: null,
  outreach: { build: null, channel: "multi", goal: "conversations", tone: "professional", workflow_id: "", linkedin_account_id: "", email_account_id: "", exclude_first_degree: true, mode: "autopilot", booking_url: "", daily_lead_cap: 25 },
  lookalike: EMPTY_LOOKALIKE,
};

/** The ICP a Warm Lookalike agent scores against: the seed's role, place, industry and sizes. */
function icpFromLookalike(base: Icp, scope: LookalikeScope): Icp {
  return {
    ...setRoles(base, scopeTitles(scope)),
    industries: scope.industry && !scope.relatedIndustries ? [scope.industry] : [],
    geographies: scope.location ? [scope.location] : [],
    company_sizes: scope.sizes.map((v) => sizePreset(v)?.value ?? v),
  };
}

const scopeFor = (p: LookalikeProfile): LookalikeScope => ({
  title: p.title ?? "", similarTitles: [], includeSimilarRoles: true, location: p.location, geoId: p.geoId,
  industry: p.industry, industryId: p.industryId, relatedIndustries: false, sizes: p.companySize ? [p.companySize] : [],
});

async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error ?? `Request failed (${r.status})`);
  return d;
}

const btn = "inline-flex h-12 items-center gap-2 rounded-[8px] px-5 text-[17px] font-medium transition-all duration-200";

/** Create an agent: Sources → Target → Preview → Outreach → Review. */
export default function NewAgent() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [s, setS] = useState<WizardState>(INITIAL);
  const [hasLinkedIn, setHasLinkedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  /** Channel the agent's current sequence was generated for ("manual" when the user built it). */
  const [campaignChannel, setCampaignChannel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));
  const setLookalike = (p: Partial<LookalikeState>) => setS((prev) => ({ ...prev, lookalike: { ...prev.lookalike, ...p } }));
  const lookalike = s.sourceKind === "lookalike";

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/icp").then((r) => r.json()).catch(() => ({})),
      fetch("/api/accounts").then((r) => r.json()).catch(() => []),
      fetch("/api/email-accounts").then((r) => r.json()).catch(() => []),
    ]).then(([icp, accounts, emails]) => {
      if (!alive) return;
      const li = (Array.isArray(accounts) ? accounts as Array<{ id: string; is_authenticated: number }> : []).find((a) => a.is_authenticated);
      const em = (Array.isArray(emails) ? emails as Array<{ id: string }> : [])[0];
      setHasLinkedIn(!!li);
      setS((prev) => ({
        ...prev,
        ...(icp?.icp ? { icp: { ...EMPTY_ICP, ...icp.icp.data }, icpId: icp.icp.id, website: icp.icp.website_url ?? "" } : {}),
        // Smart lead finder starts on when a LinkedIn seat can run it.
        sources: li ? [{ source_type: "lookalike", enabled: true, config: {} }] : prev.sources,
        outreach: { ...prev.outreach, linkedin_account_id: li?.id ?? "", email_account_id: em?.id ?? "", channel: li && em ? "multi" : em ? "email" : "linkedin" },
      }));
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [step]);

  async function saveIcp(icp: Icp = s.icp, known: string | null = s.icpId): Promise<string> {
    if (known) return known;
    const id = (await api("/api/icp", "POST", { data: icp, website_url: s.website || null })).id as string;
    set({ icpId: id });
    return id;
  }

  async function saveTargetAndAgent(icp: Icp = s.icp, known: string | null = s.icpId) {
    if (!roleTitles(icp).length && icp.match_mode !== "skip") throw new Error("Add at least one job role to target");
    const icpId = await saveIcp(icp, known);
    const base = { name: s.name.trim(), icp_id: icpId, min_score: s.minScore, linkedin_account_id: s.outreach.linkedin_account_id || null };
    let agentId = s.agentId;
    if (!agentId) {
      agentId = (await api("/api/agents", "POST", { ...base, mode: s.outreach.mode, sources: sourcesFor(s) })).id as string;
    } else {
      await api(`/api/agents/${agentId}`, "PATCH", base);
      for (const old of await api(`/api/agents/${agentId}/sources`, "GET") as Array<{ id: string }>) await api(`/api/agents/${agentId}/sources?source_id=${old.id}`, "DELETE");
      for (const src of sourcesFor(s)) await api(`/api/agents/${agentId}/sources`, "POST", src);
    }
    set({ agentId });
  }

  /** Manual setup starts from the default sequence, which the user then edits in place. */
  async function createManualSequence() {
    if (!s.agentId) return;
    const o = s.outreach;
    try {
      const channel = o.linkedin_account_id && o.email_account_id ? "multi" : o.email_account_id ? "email" : "linkedin";
      const updated = await api(`/api/agents/${s.agentId}`, "PATCH", {
        channel, create_default_campaign: true,
        linkedin_account_id: o.linkedin_account_id || null, email_account_id: o.email_account_id || null,
      }) as { workflow_id: string | null };
      setS((prev) => ({ ...prev, outreach: { ...prev.outreach, build: "manual", workflow_id: updated.workflow_id ?? "" } }));
      setCampaignChannel("manual");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the sequence");
    }
  }

  async function saveOutreach() {
    const o = s.outreach;
    const icpChanged = !s.icpId;
    const icpId = await saveIcp();
    const manual = o.build === "manual";
    const channel = manual ? (o.linkedin_account_id && o.email_account_id ? "multi" : o.email_account_id ? "email" : "linkedin") : o.channel;
    const needCampaign = !manual && campaignChannel !== o.channel;
    await api(`/api/agents/${s.agentId}`, "PATCH", {
      mode: o.mode, goal: o.goal, tone: o.tone, channel, exclude_first_degree: o.exclude_first_degree, daily_lead_cap: o.daily_lead_cap,
      linkedin_account_id: channel === "email" ? null : o.linkedin_account_id || null,
      email_account_id: channel === "linkedin" ? null : o.email_account_id || null,
      booking_url: o.booking_url || null,
      ...(icpChanged ? { icp_id: icpId } : {}),
      ...(needCampaign ? { create_default_campaign: true } : {}),
    });
    if (needCampaign) setCampaignChannel(o.channel);
  }

  const blocker = step === 0 ? sourcesReady(s) : step === 2 ? (previewing ? "Finding your first leads…" : null) : step === 3 ? outreachReady(s.outreach) : null;

  /**
   * Warm Lookalike walks its own phases inside Sources: read the seed profile, search for
   * people like them, then create the agent and jump straight to Outreach (the scope is the
   * targeting and the matches are the preview).
   */
  async function lookalikeNext() {
    const lk = s.lookalike;
    if (lk.phase === "input") {
      setLookalike({ phase: "analyzing" });
      try {
        const { profile } = await api("/api/agents/lookalike", "POST", { action: "profile", url: lk.url, account_id: s.outreach.linkedin_account_id || null }) as { profile: LookalikeProfile };
        setLookalike({ phase: "profile", profile, scope: scopeFor(profile), leads: [], searchUrl: "" });
        if (!s.name.trim()) set({ name: `Lookalike · ${profile.name}` });
      } catch (err) {
        setLookalike({ phase: "input" });
        setError(err instanceof Error ? err.message : "An error occurred while searching for the profile. Please try again.");
      }
      return;
    }
    if (lk.phase === "profile" && lk.scope) {
      setLookalike({ phase: "searching" });
      try {
        const r = await api("/api/agents/lookalike", "POST", { action: "search", scope: lk.scope, seed_name: lk.profile?.name ?? null, account_id: s.outreach.linkedin_account_id || null }) as { leads: LookalikeState["leads"]; search_url: string };
        setLookalike({ phase: "leads", leads: r.leads, searchUrl: r.search_url });
      } catch (err) {
        setLookalike({ phase: "profile" });
        setError(err instanceof Error ? err.message : "The search failed. Please try again.");
      }
      return;
    }
    if (lk.phase === "leads" && lk.scope) {
      setBusy(true);
      try {
        const icp = icpFromLookalike(s.icp, lk.scope);
        set({ icp, icpId: null });
        await saveTargetAndAgent(icp, null);
        setStep(3);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not create the agent");
      } finally { setBusy(false); }
    }
  }

  function previous() {
    if (step === 0 && lookalike) {
      const phase = s.lookalike.phase;
      if (phase === "leads") setLookalike({ phase: "profile" });
      else if (phase === "profile") setLookalike({ phase: "input", profile: null, scope: null });
      return;
    }
    setStep(step === 3 && lookalike ? 0 : step - 1);
  }

  async function next() {
    if (blocker) return toast.error(blocker);
    if (step === 0 && lookalike) return lookalikeNext();
    setBusy(true);
    try {
      if (step === 1) await saveTargetAndAgent();
      if (step === 3) await saveOutreach();
      setStep(step + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally { setBusy(false); }
  }

  async function launch() {
    setBusy(true);
    try {
      await api(`/api/agents/${s.agentId}`, "PATCH", { status: "active", outreach_enabled: false });
      router.push(`/agents/${s.agentId}?launched=1`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not launch");
      setBusy(false);
    }
  }

  const hint = step === 0 && s.sourceKind ? blocker ?? (s.sourceKind === "signals" ? "Add at least 4 signals to continue. Maximum 15." : "") : step === 3 && s.outreach.build ? blocker ?? "" : "";
  const last = step === STEPS.length - 1;

  return (
    <>
      <Head><title>New agent — Linki</title></Head>
      <div className="mb-8 border-b border-[var(--border-subtle)] pb-5">
        <div className="flex items-center gap-3"><RiBroadcastLine size={20} className="text-primary" /><h1 className="text-[22px] font-medium text-base-content">Outreach Agents</h1></div>
        <p className="mt-1 pl-1 text-[15px] text-base-content/65">Manage your automated outreach agents</p>
      </div>

      <div className="space-y-10 pb-32">
        <Stepper steps={STEPS} current={step} />

        <div key={step}>
          {step === 0 && <SourcesStep state={s} set={set} setLookalike={setLookalike} hasLinkedIn={hasLinkedIn} />}
          {step === 1 && <TargetStep state={s} set={set} />}
          {step === 2 && s.agentId && <PreviewStep agentId={s.agentId} onBusy={setPreviewing} />}
          {step === 3 && <OutreachStep state={s} set={set} onManual={createManualSequence} onEditSources={() => setStep(0)} />}
          {step === 4 && <ReviewStep state={s} />}
        </div>
      </div>

      {error && <ErrorDialog message={error} onClose={() => setError(null)} />}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border-subtle)] bg-base-100/95 shadow-[0_-8px_24px_rgba(20,20,19,0.04)] backdrop-blur md:left-[264px]">
        <div className="flex items-center justify-between gap-4 px-6 py-4 sm:px-10">
          <div className="flex min-w-0 items-center gap-4">
            {(step > 0 || (lookalike && s.lookalike.phase !== "input")) && (
              <button type="button" className={`${btn} -ml-3 text-base-content hover:bg-base-200 disabled:opacity-40`} disabled={busy || s.lookalike.phase === "analyzing" || s.lookalike.phase === "searching"} onClick={previous}>
                <RiArrowLeftSLine size={22} /> Previous
              </button>
            )}
            {hint && <span className="truncate text-[15px] text-base-content/60">{hint}</span>}
          </div>
          {!last ? (
            <button type="button" onClick={next} disabled={busy || !!blocker} title={blocker ?? undefined}
              className={`${btn} bg-primary text-primary-content hover:bg-[var(--primary-hover)] disabled:bg-base-200 disabled:text-base-content/35`}>
              {busy ? <><RiLoader4Line size={18} className="animate-spin" /> Saving…</> : <>Next <RiArrowRightSLine size={22} /></>}
            </button>
          ) : (
            <button type="button" onClick={launch} disabled={busy}
              className={`${btn} border-2 border-primary/40 bg-primary text-primary-content shadow-[0_0_0_3px_rgba(217,119,87,0.15)] hover:bg-[var(--primary-hover)] disabled:border-transparent disabled:bg-base-200 disabled:text-base-content/35 disabled:shadow-none`}>
              {busy ? <><RiLoader4Line size={18} className="animate-spin" /> Launching…</> : <>Launch now <RiRocket2Line size={20} /></>}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
