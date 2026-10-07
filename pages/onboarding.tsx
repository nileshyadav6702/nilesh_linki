import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { RiArrowLeftLine, RiArrowRightLine, RiMagicLine, RiRocketLine } from "react-icons/ri";
import IcpEditor, { EMPTY_ICP } from "@/components/agents/IcpEditor";
import SourcePicker, { type SourceDraft } from "@/components/agents/SourcePicker";
import { Card, Field, inputCls, PageHeader, primaryBtn, secondaryBtn } from "@/components/agents/ui";
import type { Icp } from "@/lib/icp/schema";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

interface Option { id: string; name?: string; email?: string; from_email?: string; is_authenticated?: number }

const STEPS = ["Website", "Ideal customer", "Signals", "Senders", "Launch"] as const;

/** Signup → running agent: website → ICP → signals → senders → launch. */
export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [website, setWebsite] = useState("");
  const [icp, setIcp] = useState<Icp>(EMPTY_ICP);
  const [icpKey, setIcpKey] = useState(0);
  const [drafting, setDrafting] = useState(false);
  const [sources, setSources] = useState<SourceDraft[]>([]);
  const [accounts, setAccounts] = useState<Option[]>([]);
  const [emailAccounts, setEmailAccounts] = useState<Option[]>([]);
  const [workflows, setWorkflows] = useState<Option[]>([]);
  const [form, setForm] = useState({ name: "My first agent", linkedin_account_id: "", email_account_id: "", workflow_id: "", mode: "copilot", daily_lead_cap: 25, min_score: 55, booking_url: "" });
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then((a: Option[]) => {
      setAccounts(a);
      const ok = a.find((x) => x.is_authenticated);
      if (ok) setForm((f) => ({ ...f, linkedin_account_id: ok.id }));
    }).catch(() => {});
    fetch("/api/email-accounts").then((r) => r.json()).then(setEmailAccounts).catch(() => {});
    fetch("/api/workflows").then((r) => r.json()).then(setWorkflows).catch(() => {});
    fetch("/api/icp").then((r) => r.json()).then((d) => {
      if (d.icp) { setIcp(d.icp.data); setWebsite(d.icp.website_url ?? ""); setIcpKey((k) => k + 1); }
    }).catch(() => {});
  }, []);

  // Pre-fill signal sources from the ICP once it exists.
  useEffect(() => {
    if (sources.length) return;
    const competitorUrls = icp.competitors.map((c) => c.linkedin_url).filter((u): u is string => !!u);
    if (!competitorUrls.length && !icp.keywords.length) return;
    setSources([
      { source_type: "competitor_engagement", enabled: competitorUrls.length > 0, config: { urls: competitorUrls } },
      { source_type: "keyword_engagement", enabled: icp.keywords.length > 0, config: { keywords: icp.keywords.slice(0, 5) } },
      { source_type: "funding", enabled: false, config: {} },
    ]);
  }, [icp, sources.length]);

  const hasLinkedIn = useMemo(() => accounts.some((a) => a.is_authenticated), [accounts]);

  async function draftIcp() {
    if (!website.trim()) return toast.error("Enter your website");
    setDrafting(true);
    try {
      const r = await fetch("/api/icp/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ website_url: website }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setIcp(d.icp);
      setWebsite(d.website_url);
      setIcpKey((k) => k + 1);
      setSources([]);
      toast.success(`Read ${d.pages.length} page${d.pages.length === 1 ? "" : "s"} of your site`);
      setStep(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the website");
    } finally {
      setDrafting(false);
    }
  }

  async function launch(activate: boolean) {
    setLaunching(true);
    try {
      const saved = await fetch("/api/icp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: icp, website_url: website || null }) });
      const icpRow = await saved.json();
      if (!saved.ok) throw new Error(icpRow.error);
      const body = {
        name: form.name, icp_id: icpRow.id, mode: form.mode, min_score: Number(form.min_score), daily_lead_cap: Number(form.daily_lead_cap),
        linkedin_account_id: form.linkedin_account_id || null, email_account_id: form.email_account_id || null,
        workflow_id: form.workflow_id || null, create_default_campaign: !form.workflow_id, booking_url: form.booking_url || null,
        sources: sources.filter((s) => s.enabled).map((s) => ({ source_type: s.source_type, config: s.config })),
      };
      const r = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const agent = await r.json();
      if (!r.ok) throw new Error(agent.error);
      if (activate) {
        const a = await fetch(`/api/agents/${agent.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "active" }) });
        if (!a.ok) toast.error((await a.json()).error ?? "Agent saved but not activated");
        else toast.success("Your agent is running");
      } else toast.success("Agent saved as a draft");
      router.push(`/agents/${agent.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the agent");
    } finally {
      setLaunching(false);
    }
  }

  const canNext = step === 1 ? icp.personas.some((p) => p.titles.length) : step === 2 ? sources.some((s) => s.enabled) : step === 3 ? !!(form.linkedin_account_id || form.email_account_id) : true;

  return (
    <>
      <Head><title>Launch an agent — Linki</title></Head>
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader eyebrow="AI agent" title="Launch your AI SDR" subtitle="Tell it what you sell; it finds people showing buying intent and reaches out." />

        <ol className="flex flex-wrap gap-2 text-xs">
          {STEPS.map((s, i) => (
            <li key={s} className={`rounded-full px-3 py-1 font-medium ${i === step ? "bg-primary text-primary-content" : i < step ? "bg-base-300 text-base-content/70" : "bg-base-200 text-base-content/40"}`}>{i + 1}. {s}</li>
          ))}
        </ol>

        {step === 0 && (
          <Card className="space-y-4">
            <Field label="Your website" hint="Linki reads it to work out what you sell, who buys it and who you compete with.">
              <input className={inputCls} placeholder="https://yourcompany.com" value={website} onChange={(e) => setWebsite(e.target.value)} onKeyDown={(e) => e.key === "Enter" && draftIcp()} autoFocus />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button className={primaryBtn} onClick={draftIcp} disabled={drafting}><RiMagicLine size={16} />{drafting ? "Reading your site…" : "Build my ICP"}</button>
              <button className={secondaryBtn} onClick={() => setStep(1)}>Write it myself</button>
            </div>
            <p className="text-xs text-base-content/45">Needs an OpenRouter key and default model in <Link className="underline" href="/settings">Settings</Link>.</p>
          </Card>
        )}

        {step === 1 && <Card><IcpEditor key={icpKey} value={icp} onChange={setIcp} /></Card>}

        {step === 2 && (
          <Card className="space-y-3">
            <p className="text-sm text-base-content/60">Pick the buying signals your agent watches. Start with one or two; you can add more later.</p>
            <SourcePicker value={sources} onChange={setSources} hasLinkedIn={hasLinkedIn} />
          </Card>
        )}

        {step === 3 && (
          <Card className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="LinkedIn account" hint={accounts.length ? "Used for discovery and outreach, within its daily limits" : <Link className="underline" href="/settings">Connect a LinkedIn account</Link>}>
                <select className={inputCls} value={form.linkedin_account_id} onChange={(e) => setForm({ ...form, linkedin_account_id: e.target.value })}>
                  <option value="">None</option>
                  {accounts.map((a) => <option key={a.id} value={a.id} disabled={!a.is_authenticated}>{a.name ?? a.email}{a.is_authenticated ? "" : " (not authenticated)"}</option>)}
                </select>
              </Field>
              <Field label="Email account" hint="Optional — adds an email track">
                <select className={inputCls} value={form.email_account_id} onChange={(e) => setForm({ ...form, email_account_id: e.target.value })}>
                  <option value="">None</option>
                  {emailAccounts.map((a) => <option key={a.id} value={a.id}>{a.from_email ?? a.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Campaign" hint="Leave on the default to get connect → personal first touch → AI follow-ups">
              <select className={inputCls} value={form.workflow_id} onChange={(e) => setForm({ ...form, workflow_id: e.target.value })}>
                <option value="">Create a signal campaign for me</option>
                {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="Meeting link" hint="Offered in AI reply drafts to interested prospects">
              <input className={inputCls} placeholder="https://cal.com/you/intro" value={form.booking_url} onChange={(e) => setForm({ ...form, booking_url: e.target.value })} />
            </Field>
          </Card>
        )}

        {step === 4 && (
          <Card className="space-y-4">
            <Field label="Agent name"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Mode" hint={form.mode === "copilot" ? "You approve every first message" : "Sends after 60 min unless you reject"}>
                <select className={inputCls} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                  <option value="copilot">Copilot</option>
                  <option value="autopilot">Autopilot</option>
                </select>
              </Field>
              <Field label="New leads contacted per day"><input type="number" min={1} max={500} className={inputCls} value={form.daily_lead_cap} onChange={(e) => setForm({ ...form, daily_lead_cap: Number(e.target.value) })} /></Field>
              <Field label="Minimum lead score"><input type="number" min={0} max={100} className={inputCls} value={form.min_score} onChange={(e) => setForm({ ...form, min_score: Number(e.target.value) })} /></Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={primaryBtn} disabled={launching} onClick={() => launch(true)}><RiRocketLine size={16} />{launching ? "Launching…" : "Launch agent"}</button>
              <button className={secondaryBtn} disabled={launching} onClick={() => launch(false)}>Save as draft</button>
            </div>
          </Card>
        )}

        {step > 0 && (
          <div className="flex justify-between">
            <button className={secondaryBtn} onClick={() => setStep(step - 1)}><RiArrowLeftLine size={16} /> Back</button>
            {step < STEPS.length - 1 && <button className={primaryBtn} disabled={!canNext} onClick={() => setStep(step + 1)}>Next <RiArrowRightLine size={16} /></button>}
          </div>
        )}
      </div>
    </>
  );
}
