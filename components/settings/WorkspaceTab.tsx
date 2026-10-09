import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { LuCheck, LuLoaderCircle, LuSparkles, LuTrash2 } from "react-icons/lu";
import Listbox from "@/components/agents/leads/Listbox";
import type { Icp } from "@/lib/icp/schema";

/**
 * Settings → Workspace: the company profile every AI message is written from (the workspace
 * ICP — saved as a new version) and workspace-wide agent preferences.
 */

const SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10000+"].map((s) => ({ value: s, label: `${s} employees` }));
const INDUSTRIES = ["Software Development", "SaaS", "IT Services and IT Consulting", "Marketing Services", "Advertising Services", "Staffing and Recruiting",
  "Financial Services", "Banking", "Insurance", "E-Learning Providers", "Education", "Healthcare", "Hospitals and Health Care", "Retail", "E-Commerce",
  "Manufacturing", "Real Estate", "Construction", "Logistics and Supply Chain", "Telecommunications", "Media and Entertainment", "Consulting", "Legal Services", "Non-profit"];

type Profile = Pick<Icp, "company_name" | "company_industry" | "company_size" | "company_linkedin_url" | "offer" | "pain_points" | "value_props" | "social_proof">;
const PROFILE_KEYS: Array<keyof Profile> = ["company_name", "company_industry", "company_size", "company_linkedin_url", "offer", "pain_points", "value_props", "social_proof"];
const LIMITS = { offer: 1200, pains: 3000 };

const field = "h-[52px] w-full rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-4 text-[17px] text-base-content outline-none transition placeholder:text-base-content/40 focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]";
const area = "block w-full resize-y rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-4 pb-8 pt-3 text-[17px] leading-relaxed text-base-content outline-none transition placeholder:text-base-content/40 focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]";

function Field({ label, required, children, className = "" }: { label: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-2.5 text-[17px] font-medium text-base-content">{label}{required && <span className="text-base-content/70"> *</span>}</div>
      {children}
    </div>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  return <span className={`pointer-events-none absolute bottom-2.5 right-4 text-[13px] tabular-nums ${n > max ? "text-error" : "text-base-content/45"}`}>{n}/{max}</span>;
}

/** Editable list: one input per item with a delete button, then an "Add" row. */
function ListEditor({ items, onChange, placeholder, max = 12 }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; max?: number }) {
  const [draft, setDraft] = useState("");
  const add = () => { const v = draft.trim(); if (!v || items.length >= max) return; onChange([...items, v]); setDraft(""); };
  return (
    <div className="space-y-2.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-3">
          <input className={field} value={it} maxLength={300} aria-label={`${placeholder.replace("...", "")} ${i + 1}`}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove" title="Remove"
            style={{ color: "#ef4444" }} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] transition-colors hover:bg-[#ef4444]/10"><LuTrash2 size={21} /></button>
        </div>
      ))}
      {items.length < max && (
        <form className="flex items-center gap-3" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input className={field} value={draft} maxLength={300} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" disabled={!draft.trim()} className="h-12 w-[72px] shrink-0 rounded-[8px] bg-primary/10 text-[15px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:bg-base-200 disabled:text-base-content/35">Add</button>
        </form>
      )}
    </div>
  );
}

function Check({ on, onChange, title, text, locked, tag }: { on: boolean; onChange: (v: boolean) => void; title: string; text: string; locked?: boolean; tag?: string }) {
  return (
    <label className={`flex items-start gap-4 ${locked ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
      <input type="checkbox" className="peer sr-only" checked={on} disabled={locked} onChange={(e) => onChange(e.target.checked)} />
      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] ${on ? "border-primary bg-primary text-primary-content" : "border-primary/40 bg-base-100"}`}>
        {on && <LuCheck size={18} strokeWidth={3} />}
      </span>
      <span>
        <span className="flex flex-wrap items-center gap-2 text-[17px] font-medium text-base-content">{title}{tag && <span className="rounded-full bg-base-200 px-2.5 py-0.5 text-[12px] font-medium text-base-content/60">{tag}</span>}</span>
        <span className="mt-1 block text-[15px] text-base-content/60">{text}</span>
      </span>
    </label>
  );
}

export default function WorkspaceTab() {
  const [base, setBase] = useState<Icp | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [website, setWebsite] = useState("");
  const [savedWebsite, setSavedWebsite] = useState("");
  const [pains, setPains] = useState("");
  const [prefs, setPrefs] = useState<{ auto_enrich_emails: boolean; exclude_first_degree: boolean; company_dedup: boolean } | null>(null);
  const [savedPrefs, setSavedPrefs] = useState<typeof prefs>(null);
  const [busy, setBusy] = useState<"save" | "ai" | null>(null);

  useEffect(() => {
    fetch("/api/icp").then((r) => r.json()).then((d) => {
      const data = (d.icp?.data ?? {}) as Icp;
      setBase(data);
      setProfile(Object.fromEntries(PROFILE_KEYS.map((k) => [k, data[k] ?? (Array.isArray(data[k]) ? [] : "")])) as Profile);
      setPains((data.pain_points ?? []).join("\n"));
      setWebsite(d.icp?.website_url ?? ""); setSavedWebsite(d.icp?.website_url ?? "");
    }).catch(() => toast.error("Could not load the company profile"));
    fetch("/api/settings/workspace").then((r) => r.json()).then((d) => { setPrefs(d.prefs); setSavedPrefs(d.prefs); }).catch(() => {});
  }, []);

  const painList = useMemo(() => pains.split("\n").map((s) => s.trim()).filter(Boolean), [pains]);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setProfile((p) => (p ? { ...p, [k]: v } : p));
  const profileDirty = !!profile && !!base && (website !== savedWebsite || JSON.stringify({ ...profile, pain_points: painList }) !== JSON.stringify(Object.fromEntries(PROFILE_KEYS.map((k) => [k, base[k] ?? (k === "pain_points" || k === "value_props" || k === "social_proof" ? [] : "")]))));
  const prefsDirty = JSON.stringify(prefs) !== JSON.stringify(savedPrefs);
  const tooLong = (profile?.offer.length ?? 0) > LIMITS.offer || pains.length > LIMITS.pains || painList.length > 10 || painList.some((p) => p.length > 300);

  async function generate() {
    if (!website.trim()) { toast.error("Add your website first"); return; }
    setBusy("ai");
    try {
      const r = await fetch("/api/icp/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ website_url: website.trim() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not read the website");
      const g = d.icp as Icp;
      setProfile((p) => p && ({
        ...p, company_name: g.company_name || p.company_name, company_industry: g.company_industry || p.company_industry,
        offer: g.offer || p.offer, value_props: g.value_props?.length ? g.value_props : p.value_props, social_proof: g.social_proof?.length ? g.social_proof : p.social_proof,
      }));
      if (g.pain_points?.length) setPains(g.pain_points.join("\n"));
      if (d.website_url) setWebsite(d.website_url);
      toast.success("Filled in from your website — review and save");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not generate"); }
    finally { setBusy(null); }
  }

  async function save() {
    if (!profile || !base) return;
    if (!profile.company_name.trim() || !profile.company_industry.trim() || !profile.company_size) { toast.error("Company name, industry and size are required"); return; }
    if (tooLong) { toast.error("Some fields are too long"); return; }
    setBusy("save");
    try {
      if (profileDirty) {
        const data = { ...base, ...profile, pain_points: painList, value_props: profile.value_props.map((s) => s.trim()).filter(Boolean), social_proof: profile.social_proof.map((s) => s.trim()).filter(Boolean) };
        const r = await fetch("/api/icp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data, website_url: website.trim() || null }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not save the company profile");
        setBase(d.data); setSavedWebsite(website.trim());
      }
      if (prefsDirty && prefs) {
        const r = await fetch("/api/settings/workspace", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prefs) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not save preferences");
        setPrefs(d.prefs); setSavedPrefs(d.prefs);
      }
      toast.success("Settings saved");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not save"); }
    finally { setBusy(null); }
  }

  if (!profile) return <div className="flex justify-center py-20"><LuLoaderCircle size={26} className="animate-spin text-primary" /></div>;
  return (
    <section className="wizard-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
      <div className="border-b border-[var(--border-subtle)] px-8 py-6">
        <div role="heading" aria-level={2} className="text-[22px] font-semibold text-base-content">Company Information</div>
        <div className="mt-1.5 text-[16px] text-base-content/70">These details power your AI-generated messages. Update them whenever your value proposition changes.</div>
      </div>

      <div className="space-y-7 px-8 py-7">
        <div className="rounded-[12px] bg-primary/[0.06] px-6 py-4">
          <div className="text-[16px] font-semibold" style={{ color: "#4f46e5" }}>You&apos;re editing the workspace defaults</div>
          <div className="mt-1 text-[14px]" style={{ color: "#4f46e5cc" }}>Every agent that follows the workspace profile writes its AI messages from these details. Each save keeps the previous version.</div>
        </div>

        <div className="grid gap-x-8 gap-y-7 md:grid-cols-2">
          <Field label="Company Name" required><input className={field} value={profile.company_name} maxLength={160} onChange={(e) => set("company_name", e.target.value)} placeholder="Acme Inc." /></Field>
          <Field label="Website">
            <div className="relative">
              <input className={`${field} pr-[176px]`} value={website} maxLength={400} onChange={(e) => setWebsite(e.target.value)} placeholder="acme.com" />
              <button type="button" onClick={() => void generate()} disabled={busy === "ai"}
                className="absolute right-1.5 top-1/2 inline-flex h-9 -translate-y-1/2 items-center gap-1.5 rounded-[6px] border border-primary/25 bg-primary/[0.07] px-3 text-[14px] font-medium text-primary transition-colors hover:bg-primary/[0.12] disabled:opacity-70">
                {busy === "ai" ? <LuLoaderCircle size={16} className="animate-spin" /> : <LuSparkles size={16} />} Generate with AI
              </button>
            </div>
          </Field>
          <Field label="Industry" required>
            <input className={field} list="industry-options" value={profile.company_industry} maxLength={120} onChange={(e) => set("company_industry", e.target.value)} placeholder="Start typing or pick one" />
            <datalist id="industry-options">{INDUSTRIES.map((i) => <option key={i} value={i} />)}</datalist>
          </Field>
          <Field label="Company Size" required>
            <Listbox label="Company size" value={profile.company_size} onChange={(v) => set("company_size", v)} options={SIZES} placeholder="Select company size"
              className="[&>button]:h-[52px] [&>button]:rounded-[8px] [&>button]:border-[var(--border-strong)] [&>button]:px-4 [&>button]:text-[17px]" />
          </Field>
        </div>

        <Field label="Value Proposition">
          <div className="relative">
            <textarea className={`${area} min-h-[104px]`} value={profile.offer} onChange={(e) => set("offer", e.target.value)} placeholder="What you do and the outcome you promise, in 2–4 sentences." />
            <Counter n={profile.offer.length} max={LIMITS.offer} />
          </div>
        </Field>
        <Field label="Customers' Pain Points">
          <div className="relative">
            <textarea className={`${area} min-h-[104px]`} value={pains} onChange={(e) => setPains(e.target.value)} placeholder="One pain point per line — e.g. Manual prospecting eats up the team's week." />
            <Counter n={pains.length} max={LIMITS.pains} />
          </div>
          <div className="mt-1.5 text-[13px] text-base-content/50">One per line, up to 10.</div>
        </Field>
        <Field label="Key Features"><ListEditor items={profile.value_props} onChange={(v) => set("value_props", v)} placeholder="Add a key feature..." /></Field>
        <Field label="Social Proof"><ListEditor items={profile.social_proof} onChange={(v) => set("social_proof", v)} placeholder="Add social proof..." /></Field>
        <Field label="LinkedIn Company Page">
          <input className={field} value={profile.company_linkedin_url} maxLength={300} onChange={(e) => set("company_linkedin_url", e.target.value)} placeholder="https://www.linkedin.com/company/your-company" />
        </Field>

        <div className="border-t border-[var(--border-subtle)] pt-8">
          <div role="heading" aria-level={2} className="text-[22px] font-semibold text-base-content">Company Preferences</div>
          <div className="mt-6 space-y-6">
            {prefs ? <>
              <Check on={prefs.auto_enrich_emails} onChange={(v) => setPrefs({ ...prefs, auto_enrich_emails: v })}
                title="Auto-enrich email addresses" text="Automatically find email addresses for qualified leads, for every agent with an email step." />
              <Check on={prefs.exclude_first_degree} onChange={(v) => setPrefs({ ...prefs, exclude_first_degree: v })}
                title="Skip people you're already connected with" text="Agents leave out your 1st-degree LinkedIn connections when finding new leads." />
              <Check on={false} onChange={() => {}} locked tag="Coming soon"
                title="Auto-enrich phone numbers" text="Automatically find phone numbers for qualified leads. Needs a phone data provider, which isn't connected yet." />
              <Check on onChange={() => {}} locked tag="Always on"
                title="Prevent contact duplication across team members" text="Each person exists once in the workspace, so two members' agents never import or contact the same lead twice." />
              <Check on={prefs.company_dedup} onChange={(v) => setPrefs({ ...prefs, company_dedup: v })}
                title="Prevent company duplication across team members" text="Agents skip a lead when someone from the same company is already being contacted in this workspace." />
            </> : <LuLoaderCircle size={20} className="animate-spin text-base-content/40" />}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-4 border-t border-[var(--border-subtle)] px-8 py-5">
        <span className="text-[14px] text-base-content/50">{profileDirty || prefsDirty ? "Unsaved changes" : "All changes saved"}</span>
        <button type="button" onClick={() => void save()} disabled={busy === "save" || (!profileDirty && !prefsDirty)}
          className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-primary px-6 text-[16px] font-semibold text-primary-content shadow-[0_6px_16px_-8px_var(--color-primary)] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50">
          {busy === "save" && <LuLoaderCircle size={17} className="animate-spin" />}Save Settings
        </button>
      </div>
    </section>
  );
}
