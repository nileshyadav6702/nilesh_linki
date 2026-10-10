import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiArrowUpLine, RiCloseLine, RiErrorWarningLine, RiLoader4Line, RiSearchLine, RiArrowUpSLine, RiArrowDownSLine } from "react-icons/ri";

/** "Deep Research" side drawer: up to two criteria, a vagueness check on each, then a background run. */

const MAX = 2;

export default function DeepResearchDrawer({ listId, listName, leads, companies, onClose, onStarted }: {
  listId: string; listName: string; leads: number; companies: number; onClose: () => void; onStarted: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(true);
  const [text, setText] = useState("");
  const [criteria, setCriteria] = useState<string[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = requestAnimationFrame(() => setShown(true));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => { cancelAnimationFrame(f); document.body.style.overflow = prev; };
  }, []);

  async function add() {
    const c = text.trim();
    if (!c || criteria.length >= MAX) return;
    setChecking(true); setWarning(null);
    try {
      const r = await fetch(`/api/lists/${listId}/research`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", criterion: c }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Could not check the criterion");
      if (!d.ok) { setWarning(d.message); return; }
      setCriteria([...criteria, c]); setText("");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not check the criterion"); }
    finally { setChecking(false); }
  }

  async function start() {
    setStarting(true);
    try {
      const r = await fetch(`/api/lists/${listId}/research`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", criteria }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Could not start deep research");
      toast.success("Deep research started. Results fill in as each company is checked.");
      onStarted(); onClose();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not start deep research"); setStarting(false); }
  }

  const checks = companies * Math.max(1, criteria.length);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <button type="button" tabIndex={-1} aria-label="Close" onClick={onClose} className={`absolute inset-0 bg-[#141413]/45 transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`} />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dr-title"
        className={`relative flex h-full w-full max-w-[900px] flex-col bg-base-100 shadow-[var(--shadow-overlay)] outline-none transition-transform duration-200 ease-out ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-8 py-6">
          <div>
            <div id="dr-title" className="text-[30px] font-medium leading-tight">Deep Research</div>
            <div className="mt-1 text-[17px] text-base-content/60">{listName} · {leads} leads · {companies} unique compan{companies === 1 ? "y" : "ies"}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-base-content/50 hover:text-base-content"><RiCloseLine size={26} /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-8 py-7">
          <section className="rounded-[14px] border border-primary/25 bg-primary/[0.05] px-6 py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[15px] font-medium uppercase text-primary"><RiSearchLine size={17} /> Deep Research <span className="font-normal normal-case text-base-content/50">Optional</span></div>
              <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[15px] text-primary">{open ? "Close" : "Open"}{open ? <RiArrowUpSLine size={18} /> : <RiArrowDownSLine size={18} />}</button>
            </div>
            {open && (
              <div className="wizard-rise">
                <p className="mt-3 text-[17px] leading-relaxed">Add criteria Goji should research and verify for each company. Use this for criteria that can&apos;t be reliably checked with standard filters.</p>
                <div className="mt-4 text-[14px] text-base-content/55">{criteria.length}/{MAX} criteria</div>
                {criteria.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    {criteria.map((c) => (
                      <li key={c} className="flex items-start gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3 py-2 text-[15px]">
                        <span className="min-w-0 flex-1">{c}</span>
                        <button type="button" aria-label={`Remove ${c}`} onClick={() => setCriteria(criteria.filter((x) => x !== c))} className="text-base-content/45 hover:text-error"><RiCloseLine size={18} /></button>
                      </li>
                    ))}
                  </ul>
                )}
                {criteria.length < MAX && (
                  <div className="relative mt-2">
                    <textarea value={text} onChange={(e) => { setText(e.target.value); setWarning(null); }} rows={3} maxLength={300}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void add(); } }}
                      placeholder="e.g. Sells to sales teams, has a PLG motion, is not a competitor..." aria-label="Research criterion"
                      className="w-full resize-y rounded-[10px] border border-[var(--border-strong)] bg-base-100 px-4 py-3 pr-14 text-[16px] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]" />
                    <button type="button" onClick={() => void add()} disabled={!text.trim() || checking} aria-label="Add criterion"
                      className="absolute bottom-4 right-3 flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary text-primary-content disabled:opacity-40">
                      {checking ? <RiLoader4Line size={18} className="animate-spin" /> : <RiArrowUpLine size={18} />}
                    </button>
                  </div>
                )}
                <p className="mt-2 text-[14px] text-base-content/55">Each criterion is checked once per company, on the company&apos;s own website.</p>
                {warning && <div className="wizard-rise mt-3 flex items-start gap-2 rounded-[8px] border border-[#f1d36b] bg-[#fdf6d8] px-3 py-2.5 text-[14px] text-[#9a6b00]"><RiErrorWarningLine size={17} className="mt-0.5 shrink-0" /> {warning}</div>}
              </div>
            )}
          </section>

          <section className="rounded-[14px] border border-[var(--border-subtle)] px-6 py-5">
            <div className="text-[20px] font-medium">{companies} unique compan{companies === 1 ? "y" : "ies"} · about {checks} AI check{checks === 1 ? "" : "s"}</div>
            <p className="mt-1 text-[16px] text-base-content/65">Every criterion is a must-have: a company that fails one is marked No match. Companies without a website, or whose site doesn&apos;t say, are marked Unclear.</p>
            <div className="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-4 text-[16px]">
              <span>Billed to</span><span className="text-base-content/70">Your workspace AI key</span>
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] px-8 py-5">
          <span className="text-[14px] text-base-content/55">{criteria.length ? "Runs in the background; you can leave this page." : "Add at least one criterion to start."}</span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="h-11 rounded-[8px] px-4 text-[16px] hover:bg-base-200">Cancel</button>
            <button type="button" onClick={() => void start()} disabled={!criteria.length || starting}
              className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-primary px-5 text-[16px] font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-50">
              {starting ? <RiLoader4Line size={18} className="animate-spin" /> : <RiSearchLine size={18} />} Start research
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
