import { useEffect, useState } from "react";
import { RiCloseLine, RiFocus3Line } from "react-icons/ri";

/** Shown once after launching from the wizard: a "finding leads" status card and a tip under the Leads tab. */

function useSecondsSince(start: number) {
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.round((now - start) / 1000));
}

function ago(s: number) {
  if (s < 60) return `${s} second${s === 1 ? "" : "s"} ago`;
  const m = Math.floor(s / 60);
  return `${m} minute${m === 1 ? "" : "s"} ago`;
}

export function FindingLeadsToast({ leadCount, onClose }: { leadCount: number; onClose: () => void }) {
  const [start] = useState(() => Date.now());
  const secs = useSecondsSince(start);
  return (
    <div role="status" className="wizard-rise fixed right-4 top-4 z-50 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border-subtle)] text-base-content">
          <RiFocus3Line size={22} />
          <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-base-100 bg-success" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[15px]"><span className="font-medium">{leadCount > 0 ? `${leadCount} lead${leadCount === 1 ? "" : "s"} found` : "Finding leads..."}</span><span className="text-[14px] font-medium text-success">Active</span></div>
          <div className="text-[14px] text-base-content/55">Started {ago(secs)}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Dismiss" className="flex h-8 w-8 items-center justify-center rounded-[8px] text-base-content/55 hover:bg-base-200 hover:text-base-content"><RiCloseLine size={22} /></button>
      </div>
      <div className="flex items-center gap-2.5 border-t border-[var(--border-subtle)] bg-base-200/40 px-4 py-2.5 text-[14px] text-base-content/75">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${d}ms` }} />)}
        </span>
        Hunting for high-intent leads...
      </div>
    </div>
  );
}

export function LeadsFinderTip({ onClose }: { onClose: () => void }) {
  return (
    <div role="dialog" aria-labelledby="finder-tip-title" className="wizard-rise absolute left-0 top-full z-40 mt-3 w-[500px] max-w-[calc(100vw-2rem)] rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-6 shadow-[var(--shadow-overlay)]">
      <span className="absolute -top-2 left-[220px] h-4 w-4 rotate-45 border-l border-t border-[var(--border-subtle)] bg-base-100" aria-hidden="true" />
      <div className="flex items-start justify-between gap-4">
        <h2 id="finder-tip-title" className="flex items-center gap-2.5 text-[19px] font-medium text-base-content">
          <span className="flex flex-col gap-[3px]" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="block h-[2px] w-4 -rotate-[25deg] rounded bg-primary" />)}</span>
          Your leads finder agent is running...
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" autoFocus className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-[var(--border-subtle)] text-base-content/60 hover:bg-base-200 hover:text-base-content"><RiCloseLine size={20} /></button>
      </div>
      <div className="mt-4 text-[17px] leading-relaxed text-base-content/80">Your agent is searching for leads that match your ideal customer profile. Once found, they will be automatically added to the campaign workflow.</div>
      <div className="mt-4 text-[17px] text-base-content/80">You can check your leads in a few minutes.</div>
    </div>
  );
}
