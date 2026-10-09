import { useState, type ReactNode } from "react";
import { RiAlertLine, RiLoader4Line } from "react-icons/ri";

/** Yellow-warning confirmation dialog (delete contacts, delete a list). */
export default function Confirm({ title, text, action, onCancel, onConfirm }: { title: string; text: ReactNode; action: string; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" tabIndex={-1} aria-label="Cancel" onClick={() => !busy && onCancel()} className="absolute inset-0 bg-[#141413]/45" />
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="wizard-rise relative w-full max-w-[640px] overflow-hidden rounded-[12px] bg-base-100 shadow-[var(--shadow-overlay)]">
        <div className="flex items-start gap-5 px-8 py-7">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#fdf3c4] text-[#b45309]"><RiAlertLine size={26} /></span>
          <div><div id="confirm-title" className="text-[20px] font-medium">{title}</div><div className="mt-2 text-[16px] leading-relaxed text-base-content/75">{text}</div></div>
        </div>
        <div className="flex justify-end gap-3 bg-primary/[0.06] px-8 py-4">
          <button type="button" autoFocus disabled={busy} onClick={onCancel} className="h-11 rounded-[6px] px-4 text-[15px] font-medium hover:bg-base-200">Cancel</button>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
            className="inline-flex h-11 items-center gap-2 rounded-[6px] bg-primary px-5 text-[15px] font-semibold text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-70">
            {busy && <RiLoader4Line size={16} className="animate-spin" />}{action}
          </button>
        </div>
      </div>
    </div>
  );
}
