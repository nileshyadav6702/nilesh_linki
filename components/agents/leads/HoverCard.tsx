import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";

/**
 * Shows `card` in a portal next to its trigger on hover or keyboard focus, so the leads
 * table's scroll container never clips it. A short close delay lets the pointer move into the
 * card (links inside it stay clickable).
 */
export function HoverCard({ trigger, card, width = 340, label }: { trigger: ReactNode; card: ReactNode; width?: number; label: string }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A short open delay so sweeping the pointer across a table doesn't pop every card; closing is quick.
  const show = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 150); }, []);
  const hide = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 120); }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useLayoutEffect(() => { 
    if (!open || !anchor.current || !panel.current) return;
    const r = anchor.current.getBoundingClientRect();
    const h = panel.current.offsetHeight;
    const below = r.bottom + 8;
    panel.current.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 8) : below}px`;
    panel.current.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, r.left))}px`;
  }, [open, width]);
  
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <>
      <span ref={anchor} tabIndex={0} role="button" aria-label={label} aria-expanded={open} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        onClick={(e) => e.stopPropagation()} className="inline-flex cursor-default rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        {trigger}
      </span>
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div ref={panel} role="dialog" aria-label={label} style={{ width, position: "fixed", top: -9999, left: -9999, transformOrigin: "top left" }}
              initial={{ opacity: 0, transform: "scale(0.97) translateY(-4px)" }} animate={{ opacity: 1, transform: "scale(1) translateY(0px)" }}
              exit={{ opacity: 0, transform: "scale(0.98) translateY(-2px)", transition: { duration: 0.1 } }} transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
              onMouseEnter={show} onMouseLeave={hide} onClick={(e) => e.stopPropagation()}
              className="z-[80] rounded-[14px] border border-[var(--border-subtle)] bg-base-100 p-4 text-left shadow-[0_18px_40px_-16px_rgba(20,20,19,0.35)]">
              {card}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
