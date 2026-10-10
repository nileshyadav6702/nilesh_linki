import { useEffect, type ReactNode } from "react";
import { RiCloseLine } from "react-icons/ri";

/** Shared pieces of the agent Campaign tab: the step shape, delays, variables, drawer and tooltip. */

export interface CampaignStep {
  id: string; track: "linkedin" | "email"; step_type: string; step_order: number; delay_seconds: number;
  connect_note: string | null; message_body: string | null; email_subject: string | null; email_body: string | null;
  ai_enabled: number | null; send_mode: "ai" | "fixed" | null; message_position: number | null; email_position: number | null;
  /** like_posts: how many recent posts to like (1-3). */
  like_count?: number | null;
  /** connect: skip the LinkedIn steps (and go to email) after this many days unaccepted; 0 = never. */
  skip_after_days?: number | null;
  /** connect: withdraw the pending invitation after this many days; 0 = never. */
  withdraw_after_days?: number | null;
  /** AI message steps: AI outreach template to follow; null = automatic, "none" = let Kairo write freely. */
  ai_template_id?: string | null;
  /** voice: length of the recorded message; null = nothing recorded yet. */
  voice_duration_ms?: number | null;
  [key: string]: unknown;
}

/** Wait choices offered before a step, in seconds. */
export const DELAY_OPTIONS = [3600, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 21, 30].map((d) => d * 86_400)];

export function delayLabel(seconds: number): string {
  if (seconds < 86_400) { const h = Math.max(1, Math.round(seconds / 3600)); return `${h} hour${h === 1 ? "" : "s"}`; }
  const d = Math.round(seconds / 86_400);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/** Variables the sender fills from the lead (lib/outreach/render.ts). */
export const LEAD_VARIABLES = [
  { key: "first_name", label: "FirstName" }, { key: "last_name", label: "LastName" }, { key: "full_name", label: "FullName" },
  { key: "company", label: "Company" }, { key: "title", label: "JobTitle" }, { key: "location", label: "Location" },
] as const;

export const STEP_TITLE: Record<string, string> = {
  connect: "Send Invitation", message: "Send LinkedIn Message", sales_inmail: "Send Sales InMail", visit: "Visit Profile", email: "Send Email", delay: "Wait",
  like_posts: "Like Posts", voice: "Voice Message",
};

/** "AI Icebreaker" / "AI Follow-up" / "AI Closing" by the step's place among its channel's messages. */
export function aiName(step: CampaignStep, totalOnChannel: number): string {
  const pos = (step.step_type === "email" ? step.email_position : step.message_position) ?? 1;
  const kind = pos <= 1 ? "Icebreaker" : pos >= totalOnChannel && totalOnChannel > 2 ? "Closing" : "Follow-up";
  return `AI ${kind}${step.step_type === "email" ? " Email" : ""}`;
}

/** Where a voice step's recording is stored and streamed from. */
export const voiceUrl = (workflowId: string, stepId: string) => `/api/workflows/${workflowId}/steps/${stepId}/voice`;

/** "Wait at least [select] after previous step" used by every step drawer. */
export function WaitSelect({ value, onChange }: { value: number; onChange: (sec: number) => void }) {
  const opts = Array.from(new Set([...DELAY_OPTIONS, value])).sort((a, b) => a - b);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[15px] text-base-content/70">
      <span>Wait at least</span>
      <select className="h-10 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3 text-[15px] text-base-content outline-none focus:border-[var(--border-focus)]" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {opts.map((sec) => <option key={sec} value={sec}>{delayLabel(sec)}</option>)}
      </select>
      <span>after previous step</span>
    </div>
  );
}

/** Hover tooltip. Pure CSS, so it also works inside scrolled timelines. */
export function Tip({ text, children, side = "top", className = "" }: { text: ReactNode; children: ReactNode; side?: "top" | "bottom"; className?: string }) {
  return (
    <span className={`group/tip relative inline-flex ${className}`}>
      {children}
      <span role="tooltip" className={`pointer-events-none absolute left-1/2 z-50 w-max max-w-[320px] -translate-x-1/2 rounded-[8px] border border-[var(--border-subtle)] bg-base-100 px-3 py-2 text-left text-[14.5px] font-normal leading-snug text-base-content opacity-0 shadow-[var(--shadow-overlay)] transition-opacity group-hover/tip:opacity-100 ${side === "top" ? "bottom-full mb-2" : "top-full mt-2"}`}>{text}</span>
    </span>
  );
}

/** Right-side drawer with a sticky header and footer. Escape closes it. */
export function SideDrawer({ title, icon, onClose, footer, children, width = 640 }: { title: ReactNode; icon?: ReactNode; onClose: () => void; footer?: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button type="button" className="backdrop-in absolute inset-0 bg-[#141413]/25" onClick={onClose} aria-label="Close" />
      <aside style={{ maxWidth: width }} className="drawer-in relative flex h-full w-full flex-col bg-base-100 shadow-[var(--shadow-popover)]">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-6 py-4">
          <div role="heading" aria-level={2} className="flex min-w-0 items-center gap-2 text-[22px] font-semibold leading-tight text-base-content">{icon}<span className="truncate">{title}</span></div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-base-content/45 hover:bg-base-200 hover:text-base-content"><RiCloseLine size={20} /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-3 border-t border-[var(--border-subtle)] px-6 py-4">{footer}</footer>}
      </aside>
    </div>
  );
}

/** Selectable card with a radio dot; children show only while selected. */
export function RadioCard({ on, onSelect, title, subtitle, badge, highlight = false, children }: {
  on: boolean; onSelect: () => void; title: ReactNode; subtitle?: ReactNode; badge?: ReactNode;
  /** The recommended option: a warm tinted card while selected. */
  highlight?: boolean; children?: ReactNode;
}) {
  const tone = on
    ? highlight ? "border-[#f0785a]/55 bg-gradient-to-br from-[#fdeee9] via-[#fdf4f1] to-base-100" : "border-base-content/25 bg-base-200/40"
    : "border-[var(--border-subtle)] bg-base-100 hover:border-base-content/20";
  return (
    <div className={`relative rounded-[14px] border transition-colors ${tone}`}>
      {badge && <span className="absolute -top-3 left-5 rounded-[6px] bg-[#f0785a] px-2.5 py-0.5 text-[13.5px] font-semibold uppercase tracking-[0.5px] text-white">{badge}</span>}
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-4 px-6 py-5 text-left">
        <span className={`mt-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-[#f0785a]" : "border-base-content/25"}`}>{on && <span className="h-2.5 w-2.5 rounded-full bg-[#f0785a]" />}</span>
        <span className="min-w-0"><span className="block text-[18.5px] text-base-content">{title}</span>{subtitle && <span className="mt-1 block text-[16.5px] leading-snug text-base-content/65">{subtitle}</span>}</span>
      </button>
      {on && children && <div className="px-6 pb-6">{children}</div>}
    </div>
  );
}
