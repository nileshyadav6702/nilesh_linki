import Head from "next/head";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { RiArrowLeftSLine, RiArrowRightSLine, RiRocket2Line } from "react-icons/ri";
import { EMPTY_ICP } from "@/components/agents/IcpEditor";
import SourcesStep, { sourcesReady } from "@/components/agents/wizard/SourcesStep";
import TargetStep from "@/components/agents/wizard/TargetStep";
import PreviewStep from "@/components/agents/wizard/PreviewStep";
import OutreachStep, { outreachReady } from "@/components/agents/wizard/OutreachStep";
import ReviewStep from "@/components/agents/wizard/ReviewStep";
import { sourcesFor, type WizardState } from "@/components/agents/wizard/types";
import { PageHeader, primaryBtn, secondaryBtn } from "@/components/agents/ui";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

const STEPS = ["Sources", "Target", "Preview", "Outreach", "Review"] as const;

const INITIAL: WizardState = {
  name: "", website: "", icp: EMPTY_ICP, icpId: null, sourceKind: null, sources: [], listIds: [], importUrl: "", minScore: 55, agentId: null,
  outreach: { build: "ai", channel: "multi", goal: "conversations", tone: "professional", workflow_id: "", linkedin_account_id: "", email_account_id: "", exclude_first_degree: true, mode: "copilot", booking_url: "", daily_lead_cap: 25 },
};

async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error ?? `Request failed (${r.status})`);
  return d;
}

/** Create an agent: Sources → Target → Preview → Outreach → Review. */
export default function NewAgent() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [s, setS] = useState<WizardState>(INITIAL);
  const [hasLinkedIn, setHasLinkedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [campaignChannel, setCampaignChannel] = useState<string | null>(null);
  const [startOutreach, setStartOutreach] = useState(false);
  const set = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/icp").then((r) => r.json()).catch(() => ({})),
      fetch("/api/accounts").then((r) => r.json()).catch(() => []),
      fetch("/api/email-accounts").then((r) => r.json()).catch(() => []),
    ]).then(([icp, accounts, emails]) => {
      if (!alive) return;
      const li = (accounts as Array<{ id: string; is_authenticated: number }>).find((a) => a.is_authenticated);
      const em = (emails as Array<{ id: string }>)[0];
      setHasLinkedIn(!!li);
      setS((prev) => ({
        ...prev,
        ...(icp?.icp ? { icp: icp.icp.data, icpId: icp.icp.id, website: icp.icp.website_url ?? "" } : {}),
        outreach: { ...prev.outreach, linkedin_account_id: li?.id ?? "", email_account_id: em?.id ?? "", channel: li && em ? "multi" : em ? "email" : "linkedin" },
      }));
    });
    return () => { alive = false; };
  }, []);

  async function saveTargetAndAgent() {
    let icpId = s.icpId;
    if (!icpId) {
      if (!s.icp.personas.some((p) => p.titles.length)) throw new Error("Add at least one job title to target");
      icpId = (await api("/api/icp", "POST", { data: s.icp, website_url: s.website || null })).id as string;
    }
    const base = { name: s.name.trim(), icp_id: icpId, min_score: s.minScore, linkedin_account_id: s.outreach.linkedin_account_id || null };
    let agentId = s.agentId;
    if (!agentId) {
      agentId = (await api("/api/agents", "POST", { ...base, mode: s.outreach.mode, sources: sourcesFor(s) })).id as string;
    } else {
      await api(`/api/agents/${agentId}`, "PATCH", base);
      for (const old of await api(`/api/agents/${agentId}/sources`, "GET") as Array<{ id: string }>) await api(`/api/agents/${agentId}/sources?source_id=${old.id}`, "DELETE");
      for (const src of sourcesFor(s)) await api(`/api/agents/${agentId}/sources`, "POST", src);
    }
    set({ icpId, agentId });
  }

  async function saveOutreach() {
    const o = s.outreach;
    const needCampaign = campaignChannel !== o.channel;
    await api(`/api/agents/${s.agentId}`, "PATCH", {
      mode: o.mode, goal: o.goal, tone: o.tone, channel: o.channel, exclude_first_degree: o.exclude_first_degree, daily_lead_cap: o.daily_lead_cap,
      linkedin_account_id: o.channel === "email" ? null : o.linkedin_account_id || null,
      email_account_id: o.channel === "linkedin" ? null : o.email_account_id || null,
      booking_url: o.booking_url || null,
      ...(needCampaign ? { create_default_campaign: true } : {}),
    });
    if (needCampaign) setCampaignChannel(o.channel);
  }

  async function next() {
    const problem = step === 0 ? sourcesReady(s) : step === 3 ? outreachReady(s.outreach) : null;
    if (problem) return toast.error(problem);
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
      await api(`/api/agents/${s.agentId}`, "PATCH", { status: "active", outreach_enabled: startOutreach });
      toast.success(startOutreach ? "Agent launched — outreach is on" : "Agent launched — finding leads, outreach paused");
      router.push(`/agents/${s.agentId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not launch");
      setBusy(false);
    }
  }

  return (
    <>
      <Head><title>New agent — Linki</title></Head>
      <div className="space-y-6 pb-24">
        <PageHeader eyebrow="AI SDR" title="Outreach agents" subtitle="Manage your automated outreach agents" />
        <ol className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--border-subtle)] bg-base-100 px-5 py-4 shadow-[var(--shadow-raised)]">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2 text-sm">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${i === step ? "bg-primary text-primary-content" : i < step ? "bg-warning/15 text-warning" : "bg-base-200 text-base-content/45"}`}>{i + 1}</span>
              <span className={i === step ? "font-semibold" : i < step ? "text-warning" : "text-base-content/45"}>{label}</span>
            </li>
          ))}
        </ol>

        {step === 0 && <SourcesStep state={s} set={set} hasLinkedIn={hasLinkedIn} />}
        {step === 1 && <TargetStep state={s} set={set} />}
        {step === 2 && s.agentId && <PreviewStep agentId={s.agentId} />}
        {step === 3 && <OutreachStep state={s} set={set} />}
        {step === 4 && <ReviewStep state={s} startOutreach={startOutreach} setStartOutreach={setStartOutreach} />}

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border-subtle)] bg-base-100/95 backdrop-blur lg:left-[264px]">
          <div className="flex items-center justify-between px-6 py-3">
            {step > 0 ? <button className={secondaryBtn} disabled={busy} onClick={() => setStep(step - 1)}><RiArrowLeftSLine size={18} /> Previous</button> : <span className="text-xs text-base-content/45">{step === 0 && s.sourceKind === "signals" ? "Add signals to continue — we recommend at least 4." : ""}</span>}
            {step < STEPS.length - 1
              ? <button className={primaryBtn} disabled={busy} onClick={next}>{busy ? "Saving…" : "Next"} <RiArrowRightSLine size={18} /></button>
              : <button className={primaryBtn} disabled={busy} onClick={launch}><RiRocket2Line size={16} /> {busy ? "Launching…" : "Launch now"}</button>}
          </div>
        </div>
      </div>
    </>
  );
}
