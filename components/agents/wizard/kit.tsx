import type { ReactNode } from "react";

/** Wizard-only building blocks: the stepper, step headings, option cards, caption labels and the collapse. */

export function Stepper({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="flex w-full items-center gap-2 overflow-x-auto rounded-[16px] border border-[var(--border-subtle)] bg-base-100 px-6 py-5 shadow-[0_1px_3px_rgba(20,20,19,0.05)] sm:px-10">
      {steps.map((label, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <li key={label} className={`flex items-center gap-2.5 text-[15px] ${i < steps.length - 1 ? "flex-1" : ""}`} aria-current={on ? "step" : undefined}>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14.5px] font-semibold tabular-nums transition-colors duration-300 ${on ? "bg-base-content text-base-100" : done ? "bg-primary/10 text-primary" : "bg-base-200 text-base-content/55"}`}>
              {i + 1}
            </span>
            <span className={`whitespace-nowrap transition-colors duration-300 ${on ? "font-medium text-base-content" : done ? "text-primary" : "text-base-content/50"}`}>{label}</span>
            {i < steps.length - 1 && <span className={`mx-3 hidden h-px min-w-6 flex-1 transition-colors duration-500 sm:block ${done ? "bg-primary/60" : "bg-[var(--border-subtle)]"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Big centered question + muted subtitle that opens each step. */
export function StepHeading({ title, subtitle, align = "center" }: { title: ReactNode; subtitle?: ReactNode; align?: "center" | "left" }) {
  return (
    // Centred with flex, not mx-auto: the design system's unlayered `p { margin: 0 }` beats Tailwind margins.
    <div className={`flex flex-col gap-3 ${align === "center" ? "items-center text-center" : ""}`}>
      <h2 className="text-[30px] font-semibold leading-[1.2] tracking-[-0.6px] text-base-content">{title}</h2>
      {subtitle && <p className={`text-[17px] leading-relaxed text-base-content/60 ${align === "center" ? "max-w-2xl" : ""}`}>{subtitle}</p>}
    </div>
  );
}

/** Uppercase caption section label ("CAMPAIGN GOAL"). */
export function Caps({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-[15px] font-semibold uppercase tracking-[0.2px] text-base-content ${className}`}>{children}</div>;
}

export function RecommendedBadge() {
  return <span className="rounded-[4px] bg-primary px-2.5 py-0.5 text-[14.5px] font-medium text-primary-content">Recommended</span>;
}

export function SoonBadge() {
  return <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-base-200 px-2 py-0.5 text-[13.5px] font-medium text-base-content/55">Coming soon</span>;
}

/** A selectable card: coral hairline + tint when chosen. */
export function OptionCard({ selected, onClick, icon, title, text, badge, corner, iconBelow, className = "", disabled }: {
  selected: boolean; onClick: () => void; icon?: ReactNode; title: ReactNode; text?: ReactNode; badge?: ReactNode; corner?: ReactNode;
  /** Put the icon under the badge row (source cards) instead of in it. */
  iconBelow?: boolean; className?: string; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} disabled={disabled}
      className={`rounded-[12px] border p-5 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "border-primary/70 bg-primary/5 shadow-[0_0_0_4px_rgba(217,119,87,0.12)]" : "border-[var(--border-subtle)] bg-base-100 enabled:hover:-translate-y-0.5 enabled:hover:border-[var(--border-strong)] enabled:hover:shadow-[0_4px_14px_rgba(20,20,19,0.06)]"} ${className}`}>
      <div className={`mb-4 flex items-start justify-between gap-2 ${iconBelow ? "min-h-[26px]" : ""}`}>{badge ?? (iconBelow ? <span /> : icon)}{corner}</div>
      {iconBelow && icon && <div className="mb-5">{icon}</div>}
      <div className="text-[17px] font-medium text-base-content">{title}</div>
      {text && <div className="mt-2 text-[15px] leading-relaxed text-base-content/60">{text}</div>}
    </button>
  );
}

/** Radio-style row card used for single choices with a description. */
export function RadioCard({ selected, onClick, title, text }: { selected: boolean; onClick: () => void; title: ReactNode; text?: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onClick}
      className={`flex w-full items-start gap-3.5 rounded-[12px] border px-5 py-5 text-left transition-colors ${selected ? "border-primary/60 bg-primary/5" : "border-[var(--border-subtle)] bg-base-100 hover:border-[var(--border-strong)]"}`}>
      <span className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors ${selected ? "border-primary/60" : "border-primary/40"}`}>
        {selected && <span className="h-3 w-3 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0"><span className="block text-[17px] font-medium text-base-content">{title}</span>{text && <span className="mt-1 block text-[15px] text-base-content/55">{text}</span>}</span>
    </button>
  );
}

/** The white content sheet each step sits in; re-keyed per step so it rises in. */
export function StepSheet({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`wizard-rise w-full min-w-0 space-y-8 rounded-[20px] border border-[var(--border-subtle)] bg-base-100 px-5 py-10 sm:px-16 sm:py-14 ${className}`}>{children}</div>;
}

/** Bordered sub-section inside a step ("CAMPAIGN GOAL", "MESSAGE TONE"). */
export function Block({ title, subtitle, children, className = "" }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`wizard-rise space-y-5 rounded-[16px] border border-[var(--border-subtle)] bg-base-100 px-5 py-6 sm:px-7 ${className}`}>
      {(title || subtitle) && <div>{title && <Caps>{title}</Caps>}{subtitle && <div className="mt-1.5 text-[17px] text-base-content/60">{subtitle}</div>}</div>}
      {children}
    </section>
  );
}

/** Height-animated reveal: content stays mounted, rows grow from 0fr to 1fr. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} aria-hidden={!open} inert={!open}>
      <div className={`min-h-0 ${open ? "overflow-visible" : "overflow-hidden"}`}>{children}</div>
    </div>
  );
}

/** Blocking error dialog with a single OK (Warm Lookalike profile / search failures). */
export function ErrorDialog({ title = "Error", message, onClose }: { title?: string; message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <button type="button" tabIndex={-1} aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[#141413]/45" />
      <div role="alertdialog" aria-modal="true" aria-labelledby="wizard-error-title" aria-describedby="wizard-error-text"
        className="wizard-rise relative w-full max-w-[660px] overflow-hidden rounded-[10px] bg-base-100 shadow-[var(--shadow-overlay)]">
        <div className="flex items-start gap-5 px-8 py-8">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-error/15 text-[26px] font-semibold text-error" aria-hidden="true">!</span>
          <div className="min-w-0">
            <div id="wizard-error-title" className="text-[20px] font-medium text-base-content">{title}</div>
            <div id="wizard-error-text" className="mt-3 text-[17px] leading-relaxed text-base-content/75">{message}</div>
          </div>
        </div>
        <div className="flex justify-end bg-primary/[0.06] px-8 py-4">
          <button type="button" autoFocus onClick={onClose} className="h-11 rounded-[6px] bg-primary px-5 text-[15px] font-semibold text-primary-content hover:bg-[var(--primary-hover)]">OK</button>
        </div>
      </div>
    </div>
  );
}
