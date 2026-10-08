import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { RiCloseLine, RiDeleteBinLine, RiLoader4Line, RiSparkling2Line } from "react-icons/ri";
import type { Icp } from "@/lib/icp/schema";
import { applyDraftTargeting, clearTargeting, normalizeTargeting } from "@/lib/icp/targeting";
import { primaryBtn } from "@/components/agents/ui";
import TargetingSections from "@/components/agents/targeting/TargetingSections";

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex='-1'])";

/**
 * "Edit targeting" side drawer. Mount it only while open: it copies `icp` into a local draft,
 * and Cancel / ✕ / Escape / backdrop discard the draft (with a confirm when it changed).
 * `onSave` persists the draft and resolves true on success, which closes the drawer.
 */
export default function TargetingDrawer({ icp, websiteUrl, onClose, onSave }: {
  icp: Icp; websiteUrl: string | null; onClose: () => void; onSave: (next: Icp) => Promise<boolean>;
}) {
  const initial = useMemo(() => normalizeTargeting(icp), [icp]);
  const [draft, setDraft] = useState<Icp>(initial);
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  // Slide in, lock page scroll, focus the panel; give focus back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => setShown(true));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  function requestClose() {
    if (saving) return;
    if (dirty && !confirm("Discard your targeting changes?")) return;
    onClose();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); requestClose(); return; }
    if (e.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  async function save() {
    setSaving(true);
    const ok = await onSave(draft).catch(() => false);
    setSaving(false);
    if (ok) onClose();
  }

  async function regenerate() {
    if (!confirm("Replace job roles, industries, company types, sizes, locations and exclusions with a fresh AI draft from your website? Your other settings stay.")) return;
    const site = websiteUrl || prompt("Your company website", "https://")?.trim();
    if (!site || site === "https://") return;
    setRegenerating(true);
    try {
      const r = await fetch("/api/icp/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ website_url: site }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not regenerate targeting");
      setDraft((cur) => applyDraftTargeting(cur, d.icp as Icp));
      toast.success("Targeting regenerated. Review it, then save.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not regenerate targeting");
    } finally { setRegenerating(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" tabIndex={-1} aria-label="Close" onClick={requestClose}
        className={`absolute inset-0 bg-[#141413]/35 transition-opacity duration-300 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="targeting-title" tabIndex={-1} onKeyDown={onKey}
        className={`relative flex h-full w-full flex-col bg-base-100 shadow-[var(--shadow-overlay)] outline-none transition-transform duration-300 ease-out motion-reduce:transition-none md:w-[65%] md:min-w-[640px] ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-6 py-5">
          <div className="min-w-0">
            <h2 id="targeting-title" className="font-display text-[24px] leading-tight text-base-content">Edit targeting</h2>
            <p className="mt-1 text-sm text-base-content/55">Narrow down the leads your agent should bring in.</p>
          </div>
          <button type="button" onClick={requestClose} aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-base-content/50 hover:bg-base-200 hover:text-base-content">
            <RiCloseLine size={20} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6">
          <div className="flex items-start gap-3 rounded-[12px] bg-primary/10 px-5 py-4 text-[15px] leading-relaxed text-primary">
            <RiSparkling2Line size={18} className="mt-1 shrink-0" aria-hidden="true" />
            <p><span className="font-semibold">Targeting helps prioritize the most relevant leads and personalize outreach.</span>{" "}
              <span className="opacity-90">Fine-tune it below or choose to skip ICP filtering and scoring to include all leads.</span></p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={regenerate} disabled={regenerating || saving}
              className="inline-flex h-10 items-center gap-1.5 rounded-[8px] border border-primary/30 bg-primary/10 px-4 text-sm font-medium text-primary hover:bg-primary/15 disabled:opacity-60">
              {regenerating ? <><RiLoader4Line size={16} className="animate-spin" /> Regenerating…</> : "Regenerate with AI"}
            </button>
            <button type="button" onClick={() => setDraft((cur) => clearTargeting(cur))} disabled={regenerating || saving}
              className="inline-flex h-10 items-center gap-1.5 rounded-[8px] px-3 text-sm font-medium text-base-content/75 hover:bg-base-200 hover:text-base-content disabled:opacity-50">
              <RiDeleteBinLine size={15} /> Clear all
            </button>
          </div>

          <fieldset disabled={regenerating} className={regenerating ? "pointer-events-none opacity-60" : ""} aria-busy={regenerating}>
            <TargetingSections icp={draft} onChange={setDraft} />
          </fieldset>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-base-100 px-6 py-4">
          <button type="button" onClick={requestClose} disabled={saving} className="inline-flex h-10 items-center rounded-[8px] px-4 text-sm font-medium text-base-content/75 hover:bg-base-200 hover:text-base-content">Cancel</button>
          <button type="button" onClick={save} disabled={saving || regenerating || !dirty} className={primaryBtn}>
            {saving ? <><RiLoader4Line size={16} className="animate-spin" /> Saving…</> : "Save changes"}
          </button>
        </footer>
      </div>
    </div>
  );
}
