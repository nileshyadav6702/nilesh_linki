import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { RiAlertLine, RiLoader4Line } from "react-icons/ri";

/**
 * Warns before leaving the new-agent wizard with unsaved work. In-app links and the back button
 * get the "Leave page" dialog; a refresh or tab close gets the browser's own prompt (browsers
 * don't allow a custom one there). `onLeave` runs before navigating away (e.g. drop a draft).
 * Call the returned `allow()` before an intended navigation, such as after launching.
 */
export function useLeaveGuard(active: boolean, onLeave: () => Promise<void> | void) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const activeRef = useRef(active);
  const allowed = useRef(false);
  useEffect(() => { activeRef.current = active; });
  const guarding = () => activeRef.current && !allowed.current;

  useEffect(() => {
    // Links: catch the click before Next's <Link> handles it.
    const onClick = (e: MouseEvent) => {
      if (!guarding() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(url.pathname + url.search + url.hash);
    };
    // Back / forward: put the wizard back in the history and ask.
    const here = router.asPath;
    router.beforePopState(({ as }) => {
      if (!guarding()) return true;
      window.history.pushState(null, "", here);
      setPending(as);
      return false;
    });
    // Refresh / close tab: only the browser's built-in prompt is allowed.
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!guarding()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
      router.beforePopState(() => true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function leave() {
    if (!pending) return;
    setLeaving(true);
    try { await onLeave(); } catch { /* leaving anyway */ }
    allowed.current = true;
    void router.push(pending);
  }

  const dialog = pending ? (
    <LeaveDialog leaving={leaving} onCancel={() => !leaving && setPending(null)} onLeave={() => void leave()} />
  ) : null;
  return { dialog, allow: () => { allowed.current = true; } };
}

function LeaveDialog({ leaving, onCancel, onLeave }: { leaving: boolean; onCancel: () => void; onLeave: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <button type="button" tabIndex={-1} aria-label="Stay on this page" onClick={onCancel} className="absolute inset-0 bg-[#141413]/45" />
      <div role="alertdialog" aria-modal="true" aria-labelledby="leave-title" aria-describedby="leave-text"
        className="wizard-rise relative w-full max-w-[660px] overflow-hidden rounded-[10px] bg-base-100 shadow-[var(--shadow-overlay)]">
        <div className="flex items-start gap-5 px-8 py-8">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#fdf3c4] text-[#b45309]" aria-hidden="true"><RiAlertLine size={26} /></span>
          <div className="min-w-0">
            <div id="leave-title" className="text-[20px] font-medium text-base-content">Leave page</div>
            <div id="leave-text" className="mt-3 text-[17px] leading-relaxed text-base-content/75">Are you sure you want to leave? Your changes may not be saved.</div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 bg-primary/[0.06] px-8 py-4">
          <button type="button" autoFocus onClick={onCancel} disabled={leaving} className="h-11 rounded-[6px] px-4 text-[15px] font-medium text-base-content hover:bg-base-200 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={onLeave} disabled={leaving}
            className="inline-flex h-11 items-center gap-2 rounded-[6px] bg-primary px-5 text-[15px] font-semibold text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-70">
            {leaving && <RiLoader4Line size={16} className="animate-spin" />} Leave
          </button>
        </div>
      </div>
    </div>
  );
}
