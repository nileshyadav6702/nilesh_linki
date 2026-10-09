import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { RiLoader4Line, RiMoneyDollarCircleLine } from "react-icons/ri";

/** Building blocks of the home dashboard: cards, animated numbers, icon tiles, the deal size dialog. */

/** Counts up to `value` (ease-out, ~0.7s) whenever it changes. Respects reduced motion. */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString() }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { const r = requestAnimationFrame(() => setShown(value)); return () => cancelAnimationFrame(r); }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      setShown(start + (value - start) * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="tabular-nums">{format(shown)}</span>;
}

export function Card({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const style: CSSProperties = { animationDelay: `${delay}ms` };
  return (
    <section style={style} className={`insights-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100 transition-shadow hover:shadow-[0_6px_24px_-12px_rgba(20,20,19,0.18)] ${className}`}>
      {children}
    </section>
  );
}

const TILE = {
  coral: "bg-primary/10 text-primary",
  violet: "bg-[#efe9ff] text-[#6d4ce0]",
  teal: "bg-[#dff5ef] text-[#17876b]",
};
export function Tile({ icon, tone = "coral", size = 64 }: { icon: ReactNode; tone?: keyof typeof TILE; size?: number }) {
  return <span className={`flex shrink-0 items-center justify-center rounded-[14px] ${TILE[tone]}`} style={{ width: size, height: size }}>{icon}</span>;
}

export const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 1000 || Number.isInteger(n) ? 0 : 2 });

/** "Edit your average deal size": pipeline = deal size × LinkedIn & email replies. */
export function DealSizeDialog({ value, onCancel, onSave }: { value: number | null; onCancel: () => void; onSave: (v: number | null) => Promise<void> }) {
  const [draft, setDraft] = useState(value ? String(value) : "");
  const [busy, setBusy] = useState(false);
  const n = Number(draft);
  const valid = draft.trim() === "" || (Number.isFinite(n) && n > 0);
  async function save() {
    if (!valid) return;
    setBusy(true);
    try { await onSave(draft.trim() === "" ? null : n); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" tabIndex={-1} aria-label="Cancel" onClick={() => !busy && onCancel()} className="absolute inset-0 bg-[#141413]/45" />
      <div role="dialog" aria-modal="true" aria-labelledby="deal-title" className="wizard-rise relative w-full max-w-[580px] rounded-[16px] bg-base-100 p-8 shadow-[var(--shadow-overlay)]">
        <div id="deal-title" className="text-[22px] font-medium">Edit your average deal size</div>
        <div className="mt-4 space-y-4 text-[16px] leading-relaxed text-base-content/75">
          <div>Your pipeline value is automatically calculated using:</div>
          <div className="rounded-[10px] bg-primary/[0.07] px-4 py-3 font-medium text-base-content">Average deal size × Number of LinkedIn &amp; Email replies</div>
          <div>This helps you estimate how much revenue your AI agents are generating for you in real time. To keep it accurate, make sure your average deal size reflects your usual customer value.</div>
          <div className="text-[14px] text-base-content/60">Example: if you usually close $3,000 per client, set it to 3,000.</div>
        </div>
        <label className="relative mt-6 block">
          <span className="sr-only">Average deal size in US dollars</span>
          <RiMoneyDollarCircleLine size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base-content/45" />
          <input autoFocus inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))} placeholder="3000"
            onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") onCancel(); }}
            className={`h-12 w-full rounded-[10px] border bg-base-100 pl-11 pr-4 text-[17px] tabular-nums outline-none focus:ring-2 focus:ring-[var(--ring)] ${valid ? "border-[var(--border-strong)] focus:border-primary/60" : "border-error"}`} />
        </label>
        {!valid && <div className="mt-1.5 text-[13px] text-error">Enter an amount greater than 0.</div>}
        <div className="mt-7 flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="h-11 rounded-[8px] px-4 text-[15px] font-medium hover:bg-base-200">Cancel</button>
          <button type="button" disabled={busy || !valid} onClick={() => void save()}
            className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-primary px-6 text-[15px] font-semibold text-primary-content shadow-[0_6px_16px_-6px_var(--color-primary)] hover:bg-[var(--primary-hover)] disabled:opacity-60">
            {busy && <RiLoader4Line size={16} className="animate-spin" />}Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
