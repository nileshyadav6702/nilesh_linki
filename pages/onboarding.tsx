import type { GetServerSideProps } from "next";
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { RiArrowLeftSLine, RiArrowRightSLine, RiCheckLine, RiRocket2Line } from "react-icons/ri";
import { EMPTY_ICP } from "@/components/agents/IcpEditor";
import SourcesStep, { sourcesReady } from "@/components/agents/wizard/SourcesStep";
import TargetStep from "@/components/agents/wizard/TargetStep";
import OutreachStep, { outreachReady } from "@/components/agents/wizard/OutreachStep";
import ReviewStep from "@/components/agents/wizard/ReviewStep";
import { sourcesFor, type WizardState } from "@/components/agents/wizard/types";
import { primaryBtn, secondaryBtn } from "@/components/agents/ui";
import { listAgents } from "@/lib/agents/store";
import { getServerWorkspace, loginRedirect } from "@/lib/server-workspace";

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const workspace = await getServerWorkspace(req, res);
  if (!workspace) return loginRedirect(req);
  if (listAgents(workspace.workspaceId).length > 0) {
    return { redirect: { destination: "/agents", permanent: false } };
  }
  return { props: {} };
};

const STEPS = ["Find leads", "Who to reach", "How to reach them", "Review"] as const;

const INITIAL: WizardState = {
  name: "", website: "", icp: EMPTY_ICP, icpId: null, sourceKind: null, sources: [], listIds: [], importUrl: "", minScore: 55, agentId: null,
  outreach: { build: "ai", channel: "multi", goal: "conversations", tone: "professional", workflow_id: "", linkedin_account_id: "", email_account_id: "", exclude_first_degree: true, mode: "copilot", booking_url: "", daily_lead_cap: 25 },
};

const BEATS = [
  { title: "Find people", text: "Choose where leads come from. The agent keeps looking." },
  { title: "Decide who fits", text: "Titles, industry, and company size decide who is worth a draft." },
  { title: "You approve the send", text: "LinkedIn, email, or both. Nothing goes out until you say so." },
];

async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error ?? `Request failed (${r.status})`);
  return d;
}

/** First-run setup. A new workspace starts its first agent here, then lands on it. */
export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [s, setS] = useState<WizardState>(INITIAL);
  const [hasLinkedIn, setHasLinkedIn] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendersLoaded, setSendersLoaded] = useState(false);
  const [startOutreach, setStartOutreach] = useState(false);
  const set = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));
  const canSend = !!(s.outreach.linkedin_account_id || s.outreach.email_account_id);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/accounts").then((r) => r.json()).catch(() => []),
      fetch("/api/email-accounts").then((r) => r.json()).catch(() => []),
    ]).then(([accounts, emails]) => {
      if (!alive) return;
      const li = (accounts as Array<{ id: string; is_authenticated: number }>).find((a) => a.is_authenticated);
      const em = (emails as Array<{ id: string }>)[0];
      setHasLinkedIn(!!li);
      setHasEmail(!!em);
      setSendersLoaded(true);
      setS((prev) => ({
        ...prev,
        outreach: { ...prev.outreach, linkedin_account_id: li?.id ?? "", email_account_id: em?.id ?? "", channel: li && em ? "multi" : em ? "email" : "linkedin" },
      }));
    });
    return () => { alive = false; };
  }, []);

  function next() {
    if (step === 1) {
      const problem = sourcesReady(s);
      if (problem) return toast.error(problem);
    }
    if (step === 2 && !s.icp.personas.some((p) => p.titles.length)) {
      return toast.error("Add at least one job title to target");
    }
    if (step === 3) {
      if (!sendersLoaded) return toast.error("Still checking your senders");
      const problem = outreachReady(s.outreach);
      if (problem && (hasLinkedIn || hasEmail)) return toast.error(problem);
    }
    setStep(step + 1);
  }

  async function launch() {
    setBusy(true);
    try {
      if (!s.icp.personas.some((p) => p.titles.length)) throw new Error("Add at least one job title to target");
      const o = s.outreach;
      const icpId = (await api("/api/icp", "POST", { data: s.icp, website_url: s.website || null })).id as string;
      const agentId = (await api("/api/agents", "POST", {
        name: s.name.trim(), icp_id: icpId, min_score: s.minScore, mode: o.mode,
        linkedin_account_id: o.linkedin_account_id || null,
        sources: sourcesFor(s),
      })).id as string;
      await api(`/api/agents/${agentId}`, "PATCH", {
        mode: o.mode, goal: o.goal, tone: o.tone, channel: o.channel, exclude_first_degree: o.exclude_first_degree, daily_lead_cap: o.daily_lead_cap,
        linkedin_account_id: o.channel === "email" ? null : o.linkedin_account_id || null,
        email_account_id: o.channel === "linkedin" ? null : o.email_account_id || null,
        booking_url: o.booking_url || null,
        create_default_campaign: true,
      });
      const sending = startOutreach && canSend;
      await api(`/api/agents/${agentId}`, "PATCH", { status: "active", outreach_enabled: sending });
      toast.success(sending ? "Your agent is finding leads and outreach is on" : "Your agent is finding leads. Outreach stays off until you add a sender.");
      router.push(`/agents/${agentId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the agent");
      setBusy(false);
    }
  }

  return (
    <>
      <Head><title>Start your first agent — Linki</title></Head>
      <div className="min-h-screen bg-base-100">
        <header className="flex h-16 items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/agents" className="flex items-center gap-2.5">
            <Image src="/logo_linki.svg" alt="" width={26} height={26} />
            <span className="font-display text-[22px] text-base-content">Linki</span>
          </Link>
          {step > 0 && <p className="text-sm text-base-content/45">{step} of {STEPS.length}</p>}
          <button type="button" className="text-sm font-medium text-base-content/55 hover:text-base-content" onClick={() => router.push("/agents")}>Skip for now</button>
        </header>

        {step === 0 ? (
          <main className="mx-auto flex max-w-xl flex-col px-6 pb-20 pt-10 sm:pt-16">
            <p className="mb-3 text-[13px] font-medium text-base-content/45">Welcome</p>
            <h1 className="font-display text-[40px] leading-[1.05] text-base-content sm:text-[48px]">Start your first agent</h1>
            <p className="mt-4 text-[16px] leading-7 text-base-content/60">It finds people who fit, writes the sequence, and waits for your approval before anything is sent.</p>
            <ol className="mt-8 space-y-3">
              {BEATS.map((beat, i) => (
                <li key={beat.title} className="flex gap-4 rounded-[12px] border border-[var(--border-subtle)] bg-base-300 p-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-100 text-sm font-medium text-base-content">{i + 1}</span>
                  <span>
                    <span className="block text-sm font-medium text-base-content">{beat.title}</span>
                    <span className="mt-1 block text-sm text-base-content/55">{beat.text}</span>
                  </span>
                </li>
              ))}
            </ol>
            <button type="button" className={`${primaryBtn} mt-8 w-fit`} onClick={() => setStep(1)}>Start the agent <RiArrowRightSLine size={18} /></button>
          </main>
        ) : (
          <main className="mx-auto max-w-4xl px-5 pb-28 pt-6 sm:px-8">
            <ol className="mb-8 flex flex-wrap gap-2">
              {STEPS.map((label, i) => {
                const n = i + 1;
                const current = step === n;
                const done = step > n;
                return (
                  <li key={label} className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${current ? "bg-base-300 text-base-content" : "text-base-content/45"}`}>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${current ? "bg-primary text-primary-content" : done ? "bg-base-content text-base-100" : "bg-base-200 text-base-content/45"}`}>
                      {done ? <RiCheckLine size={12} /> : n}
                    </span>
                    {label}
                  </li>
                );
              })}
            </ol>

            {step === 1 && <SourcesStep state={s} set={set} hasLinkedIn={hasLinkedIn} />}
            {step === 2 && <TargetStep state={s} set={set} />}
            {step === 3 && (
              <div className="space-y-4">
                {!hasLinkedIn && !hasEmail && (
                  <p className="rounded-[12px] border border-[var(--border-subtle)] bg-base-300 px-4 py-3 text-sm text-base-content/70">No sender is connected yet. You can still start the agent. It will find leads, and outreach stays off until you add LinkedIn or email.</p>
                )}
                <OutreachStep state={s} set={set} />
              </div>
            )}
            {step === 4 && (
              <div className="space-y-4">
                {!canSend && <p className="rounded-[12px] border border-[var(--border-subtle)] bg-base-300 px-4 py-3 text-sm text-base-content/70">Outreach stays off until a sender is attached. You can add one from the agent after this.</p>}
                <ReviewStep state={s} startOutreach={canSend && startOutreach} setStartOutreach={(v) => {
                  if (v && !canSend) return toast.error("Add a LinkedIn or email sender before outreach can start.");
                  setStartOutreach(v);
                }} />
              </div>
            )}
          </main>
        )}

        {step > 0 && (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border-subtle)] bg-base-100/95 backdrop-blur">
            <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3 sm:px-8">
              <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setStep(step - 1)}><RiArrowLeftSLine size={18} /> Back</button>
              {step < 4
                ? <button type="button" className={primaryBtn} disabled={busy} onClick={next}>{busy ? "Saving…" : "Continue"} <RiArrowRightSLine size={18} /></button>
                : <button type="button" className={primaryBtn} disabled={busy} onClick={launch}><RiRocket2Line size={16} /> {busy ? "Starting…" : "Start the agent"}</button>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
