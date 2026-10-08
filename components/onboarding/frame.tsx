import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { RiArrowLeftSLine, RiArrowRightSLine, RiCheckLine } from "react-icons/ri";
import { primaryBtn } from "@/components/agents/ui";

/** Four phases. The phase you are in, and every phase before it, is a filled check. */
export function PhaseDots({ phase }: { phase: number }) {
  return (
    <div className="mt-6 flex items-center">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex items-center">
          {index > 0 && <span className="mx-1 h-px w-8 bg-base-content/15 sm:w-12" />}
          <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${index <= phase ? "bg-neutral text-neutral-content" : "border border-[var(--border-subtle)] bg-base-100 text-base-content/45"}`}>
            {index <= phase ? <RiCheckLine size={16} /> : index + 1}
          </span>
        </div>
      ))}
    </div>
  );
}

export function OnboardShell({ phase, stepLabel, ai, children, footer }: {
  phase: number; stepLabel: string | null; ai?: boolean; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-base-100 bg-[radial-gradient(ellipse_at_top,rgba(204,120,92,0.18),transparent_58%)] px-4 py-8">
      <div className="mx-auto flex w-full max-w-[860px] flex-col items-center">
        <Link href="/agents" className="flex items-center gap-2.5">
          <Image src="/logo_linki.svg" alt="" width={28} height={28} />
          <span className="font-display text-[28px] leading-none">Linki</span>
        </Link>
        <PhaseDots phase={phase} />
        <section className="mt-6 w-full rounded-[16px] border border-[var(--border-subtle)] bg-base-300 px-5 py-5 sm:px-8 sm:py-6">
          <div className="mb-4 flex min-h-6 items-center justify-between">
            {ai ? <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-content">AI-generated</span> : <span />}
            {stepLabel && <span className="text-xs text-base-content/40">{stepLabel}</span>}
          </div>
          {children}
          {footer}
        </section>
      </div>
    </div>
  );
}

export function StepFooter({ onBack, backDisabled, note, onNote, actionLabel, onAction, busy, chevron = true, footnote }: {
  onBack?: () => void; backDisabled?: boolean; note?: string; onNote?: () => void; actionLabel: string; onAction: () => void; busy?: boolean; chevron?: boolean; footnote?: string;
}) {
  return (
    <div className="mt-8 border-t border-[var(--border-subtle)] pt-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="inline-flex items-center gap-1 text-sm text-base-content/55 disabled:opacity-30" disabled={backDisabled} onClick={onBack}><RiArrowLeftSLine size={16} /> Previous</button>
        <div className="flex items-center gap-3">
          {note && (onNote ? <button type="button" className="text-sm text-base-content/55" onClick={onNote}>{note}</button> : <span className="text-sm text-base-content/40">{note}</span>)}
          <button type="button" className={primaryBtn} disabled={busy} onClick={onAction}>{busy ? "Working…" : actionLabel}{chevron && <RiArrowRightSLine size={16} />}</button>
        </div>
      </div>
      {footnote && <p className="mt-3 text-center text-xs text-base-content/40">{footnote}</p>}
    </div>
  );
}
