import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { RiAddLine, RiArrowDownSLine, RiCheckDoubleLine, RiCloseLine, RiFireFill, RiInformationLine, RiLinkedinBoxFill, RiLoader4Line, RiSparkling2Line } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { Avatar, Toggle } from "@/components/agents/ui";
import type { LookalikeState } from "@/components/agents/wizard/types";
import type { LookalikeScope } from "@/lib/agents/lookalike-rules";
import { SIZE_PRESETS } from "@/lib/icp/targeting";

/** Warm Lookalike inside the Sources step: seed profile URL → editable search scope → first matches. */

const fieldCls = "h-12 w-full rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-4 text-[15px] text-base-content outline-none transition placeholder:text-base-content/40 focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-60";
const card = "wizard-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100 px-5 py-7 sm:px-8";

/** Simple dropdown: a field button and a floating option list. */
function Dropdown({ label, value, placeholder, children, small }: { label: string; value: string | null; placeholder: string; children: (close: () => void) => ReactNode; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  return (
    <div ref={wrap} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-2 rounded-[8px] border bg-base-100 px-4 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${small ? "h-10 text-[15px]" : "h-12 text-[17px]"} ${open ? "border-primary/60" : "border-[var(--border-subtle)] hover:bg-base-200/40"}`}>
        <span className={`min-w-0 flex-1 truncate ${value ? "text-base-content" : "text-base-content/55"}`}>{value ?? placeholder}</span>
        <RiArrowDownSLine size={22} className={`shrink-0 text-base-content/55 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="pop-in absolute left-0 right-0 z-40 mt-1.5 max-h-72 overflow-y-auto rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1 shadow-[var(--shadow-overlay)]" role="listbox" aria-label={label}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

function Option({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="option" aria-selected={on} onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-[8px] px-3 py-2.5 text-left text-[15px] ${on ? "bg-primary/10 text-primary" : "hover:bg-base-200"}`}>
      {children}{on && <RiCheckDoubleLine size={16} className="shrink-0" />}
    </button>
  );
}

const Label = ({ children }: { children: ReactNode }) => <div className="mb-1.5 text-[15px] text-base-content/55">{children}</div>;

function ScopeEditor({ state, set }: { state: LookalikeState; set: (p: Partial<LookalikeState>) => void }) {
  const p = state.profile!;
  const sc = state.scope!;
  const put = (patch: Partial<LookalikeScope>) => set({ scope: { ...sc, ...patch } });
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const tried = useRef<string | null>(null);

  async function suggest(quiet = false) {
    setSuggesting(true);
    try {
      const r = await fetch("/api/agents/lookalike", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "suggest", title: sc.title, company: p.company }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not suggest roles");
      const have = new Set(sc.similarTitles.map((t) => t.toLowerCase()));
      put({ similarTitles: [...sc.similarTitles, ...(d.titles as string[]).filter((t) => !have.has(t.toLowerCase()))].slice(0, 9) });
    } catch (err) {
      if (!quiet) toast.error(err instanceof Error ? err.message : "Could not suggest roles");
    } finally { setSuggesting(false); }
  }
  // Prefill similar roles once per seed profile, like the reference flow does.
  useEffect(() => {
    if (tried.current === p.linkedinUrl || sc.similarTitles.length || !sc.title) return;
    tried.current = p.linkedinUrl;
    void suggest(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.linkedinUrl]);

  function addTitle() {
    const t = text.trim();
    if (t.length >= 2 && !sc.similarTitles.some((x) => x.toLowerCase() === t.toLowerCase())) put({ similarTitles: [...sc.similarTitles, t] });
    setText(""); setAdding(false);
  }

  const sizesLabel = sc.sizes.length ? sc.sizes.map((s) => SIZE_PRESETS.find((x) => x.value === s)?.label ?? s).join(", ") : null;
  const where = [sc.industry && <> in <b className="font-semibold text-base-content">{sc.industry}</b></>, sc.location && <> in <b className="font-semibold text-base-content">{sc.location}</b></>];

  return (
    <>
      <div className="wizard-rise flex items-center gap-3 rounded-[12px] bg-[#eef0fb] px-6 py-4 text-[17px] text-[#4f5bd5]">
        <RiInformationLine size={20} className="shrink-0" /> We&apos;ll use this profile to find similar leads. You can adjust the details below if anything looks off.
      </div>

      <section className={card}>
        <div className="flex items-center gap-4">
          <Avatar name={p.name} src={p.photo} size={52} />
          <div className="min-w-0">
            <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="block truncate text-[17px] font-medium hover:underline">{p.name}</a>
            <div className="truncate text-[15px] text-base-content/60">{p.headline ?? sc.title}</div>
          </div>
        </div>
        <div className="mt-6 grid gap-x-5 gap-y-5 md:grid-cols-2">
          <div>
            <Label>Title</Label>
            <input className={fieldCls} value={sc.title} onChange={(e) => put({ title: e.target.value })} aria-label="Title to look for" />
          </div>
          <div><Label>Company</Label><div className="flex h-12 items-center text-[17px]">{p.company ?? "—"}</div></div>
          <div>
            <Label>Location</Label>
            <Dropdown label="Location" value={sc.location} placeholder="Any location">
              {(close) => (
                <>
                  {p.location && <Option on={sc.location === p.location} onClick={() => { put({ location: p.location, geoId: p.geoId }); close(); }}>{p.location}</Option>}
                  <Option on={!sc.location} onClick={() => { put({ location: null, geoId: null }); close(); }}>Any location</Option>
                </>
              )}
            </Dropdown>
          </div>
          <div>
            <Label>Industry</Label>
            <Dropdown label="Industry" value={sc.industry} placeholder="Any industry">
              {(close) => (
                <>
                  {p.industry && <Option on={sc.industry === p.industry} onClick={() => { put({ industry: p.industry, industryId: p.industryId }); close(); }}>{p.industry}</Option>}
                  <Option on={!sc.industry} onClick={() => { put({ industry: null, industryId: null }); close(); }}>Any industry</Option>
                </>
              )}
            </Dropdown>
          </div>
          <div className="md:max-w-[420px]">
            <Label>Company Sizes</Label>
            <Dropdown label="Company sizes" value={sizesLabel} placeholder="All company sizes" small>
              {() => SIZE_PRESETS.map((s) => {
                const on = sc.sizes.includes(s.value);
                return <Option key={s.value} on={on} onClick={() => put({ sizes: on ? sc.sizes.filter((x) => x !== s.value) : [...sc.sizes, s.value] })}>{s.label}</Option>;
              })}
            </Dropdown>
          </div>
        </div>
      </section>

      <section className={`${card} space-y-6`}>
        <div>
          <div className="text-[17px] font-medium">Search scope</div>
          <p className="mt-3 text-[17px] text-base-content/65">Looking for people who are <b className="font-semibold text-base-content">{sc.title || "…"}</b>{where[0]}{where[1]}</p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[17px]">Include similar roles</span>
          <Toggle label="Include similar roles" on={sc.includeSimilarRoles} onChange={() => put({ includeSimilarRoles: !sc.includeSimilarRoles })} />
        </div>
        {sc.includeSimilarRoles && (
          <div className="wizard-rise space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[17px] text-base-content/65">Also targeting:</span>
              <button type="button" disabled={suggesting || !sc.title} onClick={() => void suggest()} className="inline-flex items-center gap-1.5 text-[15px] font-medium hover:underline disabled:opacity-50">
                {suggesting ? <RiLoader4Line size={15} className="animate-spin" /> : <RiSparkling2Line size={15} className="text-primary" />} Generate suggestions
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {sc.similarTitles.map((t) => (
                <span key={t} className="wizard-rise inline-flex items-center gap-1.5 rounded-[6px] border border-primary/25 bg-primary/10 py-1 pl-3 pr-1.5 text-[17px] text-primary">
                  {t}<button type="button" aria-label={`Remove ${t}`} onClick={() => put({ similarTitles: sc.similarTitles.filter((x) => x !== t) })} className="rounded p-0.5 hover:bg-primary/15"><RiCloseLine size={18} /></button>
                </span>
              ))}
              {adding ? (
                <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={addTitle} placeholder="Job title"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTitle(); } if (e.key === "Escape") { setText(""); setAdding(false); } }}
                  className="h-9 w-48 rounded-[6px] border border-primary/40 px-2.5 text-[15px] outline-none focus:ring-2 focus:ring-[var(--ring)]" />
              ) : (
                <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 px-2 text-[15px] font-medium text-primary hover:underline"><RiAddLine size={18} /> Add</button>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] pt-6">
          <span><span className="block text-[17px]">Include related industries</span><span className="text-[14px] text-base-content/55">Search beyond {sc.industry ?? "one industry"} and rank by how close each lead is.</span></span>
          <Toggle label="Include related industries" on={sc.relatedIndustries} onChange={() => put({ relatedIndustries: !sc.relatedIndustries })} />
        </div>
      </section>
    </>
  );
}

const STAGES = ["Analyzing your target profile...", "Finding similar profiles...", "Filtering the most relevant leads...", "Scoring & ranking results..."];

/** Staged progress while the search runs; the last stage spins until results arrive. */
function SearchProgress() {
  const [at, setAt] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAt((n) => Math.min(STAGES.length - 1, n + 1)), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <ul className="mx-auto flex w-fit flex-col gap-4 py-16 text-[17px]" aria-live="polite">
      {STAGES.map((s, i) => (
        <li key={s} className={`flex items-center gap-3 transition-opacity duration-500 ${i < at ? "text-base-content/40" : i === at ? "wizard-rise font-medium text-base-content" : "opacity-0"}`}>
          {i < at ? <RiCheckDoubleLine size={18} className="text-success/60" /> : <RiLoader4Line size={18} className="animate-spin text-primary" />}{s}
        </li>
      ))}
    </ul>
  );
}

export default function LookalikePanel({ state, set }: { state: LookalikeState; set: (p: Partial<LookalikeState>) => void }) {
  const busy = state.phase === "analyzing" || state.phase === "searching";

  if (state.phase === "searching" || state.phase === "leads") {
    return (
      <section className={card}>
        <h3 className="text-[24px] font-medium">Review Lookalike Leads</h3>
        <p className="mt-1 text-[17px] text-base-content/60">{state.phase === "searching" ? "Keep this page open while loading your leads" : "Here are your first highly relevant leads based on your lookalike profile"}</p>
        {state.phase === "searching" ? <SearchProgress /> : (
          <>
            <ul className="mt-6 space-y-3">
              {state.leads.map((l, i) => (
                <li key={l.id} className="wizard-rise flex items-center gap-4 rounded-[12px] border border-[var(--border-subtle)] px-4 py-4" style={{ animationDelay: `${i * 70}ms` }}>
                  <Avatar name={l.name} src={l.photo} size={52} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[17px] font-medium">{l.name}</span>
                      {l.url && <a href={l.url} target="_blank" rel="noreferrer" aria-label={`${l.name} on LinkedIn`} className="text-[#4338ca] hover:opacity-80"><RiLinkedinBoxFill size={20} /></a>}
                    </div>
                    <div className="truncate text-[15px] text-base-content/65">{l.title}{l.company && <> · <b className="font-semibold text-base-content/80">{l.company}</b></>}</div>
                    {l.location && <div className="truncate text-[15px] text-base-content/45">{l.location}</div>}
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5 text-[15px] text-primary">{l.match}% match <RiFireFill size={20} /></span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-center text-[15px] text-base-content/50">More will be automatically added after this campaign source is launched.</p>
          </>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {state.phase === "analyzing" ? (
        <section className="wizard-rise flex flex-col items-center gap-3 rounded-[16px] border border-primary/15 bg-primary/[0.08] px-6 py-20 text-center">
          <RiLoader4Line size={30} className="animate-spin text-primary" />
          <div className="mt-2 text-[17px] font-medium">Analyzing your lookalike profile…</div>
          <div className="text-[17px] text-base-content/60">We are enriching the LinkedIn profile and preparing the search scope.</div>
        </section>
      ) : (
        <section className={card}>
          <div className="text-[15px] font-medium uppercase text-base-content/70">LinkedIn URL of your best lead</div>
          <div className="mt-3 flex items-center gap-1.5 text-[17px]"><RiSparkling2Line size={18} className="text-primary" /> Pick someone who represents your ideal customer.</div>
          <input className={`${fieldCls} mt-3`} value={state.url} disabled={busy} placeholder="https://www.linkedin.com/in/your-best-customer"
            aria-label="LinkedIn URL of your best lead"
            onChange={(e) => set({ url: e.target.value, ...(state.phase !== "input" ? { phase: "input", profile: null, scope: null, leads: [], searchUrl: "" } : {}) })} />
          <p className="mt-2 text-[14px] text-base-content/55">Paste the LinkedIn URL of a top customer - we&apos;ll find more like them.</p>
        </section>
      )}
      {state.phase === "profile" && state.profile && state.scope && <ScopeEditor state={state} set={set} />}
    </div>
  );
}
