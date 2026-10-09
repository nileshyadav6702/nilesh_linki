import { useRef, useState } from "react";
import { RiQuestionLine } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";

const STEPS = [
  ["Find", "Each agent watches its signals (competitor and topic engagement, buying events, imports) and pulls in people who match your targeting."],
  ["Qualify", "AI scores every lead against your ICP and drops the ones that don't fit."],
  ["Reach out", "Qualified leads enter the agent's LinkedIn + email sequence, within each sender's daily limits."],
  ["Hand off", "Replies stop the sequence and land in your inbox, classified, so you can take over."],
] as const;

/** "HOW IT WORKS?" chip with a short four-step explainer. */
export default function HowItWorks() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  return (
    <div ref={wrap} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-primary/40 px-3 text-[14.5px] font-medium uppercase tracking-[0.02em] text-primary hover:bg-primary/5">
        <RiQuestionLine size={14} /> How it works?
      </button>
      {open && (
        <div role="dialog" aria-label="How agents work" className="absolute left-0 top-full z-40 mt-2 w-[min(400px,calc(100vw-32px))] rounded-[14px] border border-[var(--border-subtle)] bg-base-100 p-5 shadow-[var(--shadow-overlay)]">
          <ol className="space-y-3.5">
            {STEPS.map(([t, body], i) => (
              <li key={t} className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13.5px] font-semibold text-primary">{i + 1}</span>
                <div><div className="text-[14px] font-medium text-base-content">{t}</div><p className="text-[14.5px] leading-snug text-base-content/55">{body}</p></div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
