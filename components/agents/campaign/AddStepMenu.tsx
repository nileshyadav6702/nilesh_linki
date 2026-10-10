import { useRef, type ReactNode } from "react";
import { RiChat3Line, RiCloseLine, RiEyeLine, RiMailLine, RiMicLine, RiThumbUpLine, RiUserAddLine } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { Tip } from "@/components/agents/campaign/kit";
import type { AddRule } from "@/components/agents/campaign/sequence";

const OPTIONS: Array<{ type: string; title: string; sub: string; icon: ReactNode; tile: string; ai?: boolean; group?: string }> = [
  { type: "connect", title: "Send Connection Request", sub: "Connection request", icon: <RiUserAddLine size={22} />, tile: "bg-[#4f7cf0]/12 text-[#3b6fe0]" },
  { type: "message", title: "Send Message", sub: "Text message", icon: <RiChat3Line size={22} />, tile: "bg-[#6c5ce7]/12 text-[#5b4bd6]" },
  { type: "voice", title: "Voice Note", sub: "Record a voice note", icon: <RiMicLine size={22} />, tile: "bg-[#1fb57a]/12 text-[#14955f]", ai: true },
  { type: "visit", title: "Visit Profile", sub: "View their LinkedIn page", icon: <RiEyeLine size={22} />, tile: "bg-[#f0785a]/12 text-[#e0573a]" },
  { type: "like_posts", title: "Like Posts", sub: "Like recent LinkedIn posts", icon: <RiThumbUpLine size={22} />, tile: "bg-[#ec4f8f]/12 text-[#d93a7c]" },
  { type: "email", title: "Send Email", sub: "Personalized email to your leads", icon: <RiMailLine size={22} />, tile: "bg-[#e5484d]/10 text-[#e5484d]", group: "Email" },
];

/** "Add a step" popover above the add-step card: every step type, unavailable ones greyed with the reason. */
export default function AddStepMenu({ rules, onPick, onClose }: { rules: Record<string, AddRule>; onPick: (type: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, [ref], onClose);
  return (
    <div ref={ref} role="menu" aria-label="Add a step" style={{ transformOrigin: "bottom left" }}
      className="pop-in absolute bottom-full left-[68px] z-40 mb-3 w-[380px] rounded-[16px] border border-[var(--border-subtle)] bg-base-100 p-3 shadow-[0_24px_48px_-20px_rgba(20,20,19,0.35)]">
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-base-content/45 hover:text-base-content"><RiCloseLine size={24} /></button>
      <div className="px-3 pb-3 pt-2">
        <div className="text-[18px] font-medium text-base-content">Add a step</div>
        <div className="text-[15.5px] text-base-content/50">What should happen next in your sequence?</div>
      </div>
      {OPTIONS.map((o) => {
        const rule = rules[o.type] ?? { disabled: false };
        const item = (
          <button type="button" role="menuitem" disabled={rule.disabled} aria-disabled={rule.disabled} onClick={() => onPick(o.type)}
            className="flex w-full items-center gap-4 rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-base-200/70 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] ${o.tile}`}>{o.icon}</span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[17px] text-base-content">{o.title}
                {o.ai && <span className="rounded-full bg-[#9b5de5]/15 px-2 py-0.5 text-[12.5px] font-semibold text-[#8a3fd6]">AI</span>}
              </span>
              <span className="block text-[15px] text-base-content/50">{o.sub}</span>
            </span>
          </button>
        );
        return (
          <div key={o.type}>
            {o.group && <div className="caps px-3 pb-1 pt-3 text-center text-[13.5px] text-base-content/45">{o.group}</div>}
            {rule.disabled && rule.reason ? <Tip text={rule.reason} className="!flex w-full">{item}</Tip> : item}
          </div>
        );
      })}
      {/* Arrow pointing at the "Add a step" card below. */}
      <span aria-hidden className="absolute -bottom-[7px] left-12 h-3.5 w-3.5 rotate-45 border-b border-r border-[var(--border-subtle)] bg-base-100" />
    </div>
  );
}
