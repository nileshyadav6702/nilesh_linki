import { useState, type ReactNode } from "react";
import Link from "next/link";
import { SiGmail } from "react-icons/si";
import {
  RiAddLine, RiArrowRightLine, RiDeleteBinLine, RiFocus3Line, RiLinkedinFill, RiLoader4Line, RiMailLine, RiMore2Fill,
  RiPauseCircleLine, RiPauseLine, RiPlayFill, RiRadarLine, RiRocketLine, RiSendPlaneLine, RiUserAddLine,
} from "react-icons/ri";
import { FloatingMenu, type MenuItem } from "@/components/agents/leads/Menu";
import { primaryBtn, secondaryBtn } from "@/components/agents/ui";

export interface HeaderSenders {
  linkedin: { name: string | null; email: string | null; daily_connection_limit: number | null; daily_message_limit: number | null; is_authenticated: number } | null;
  email: { from_email: string | null; from_name: string | null; daily_email_limit: number | null; ramp_up_enabled: number | null; ramp_start_date: string | null } | null;
}

/** Hover/focus tooltip shown under its trigger. */
function Tip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-max max-w-[340px] -translate-x-1/2 rounded-[10px] border border-[var(--border-subtle)] bg-base-100 px-3.5 py-2 text-center text-[14.5px] leading-snug text-base-content/75 shadow-[var(--shadow-overlay)] group-focus-within:block group-hover:block">
        {tip}
      </span>
    </span>
  );
}

function LimitChip({ icon, value, title }: { icon: ReactNode; value: number; title: string }) {
  return (
    <Tip tip={<><div className="font-medium text-base-content">{title}</div><div>{value}/day</div></>}>
      <span tabIndex={0} className="inline-flex h-7 items-center gap-1 rounded-[6px] bg-base-200 px-2 text-[14.5px] tabular-nums text-base-content/60 outline-none hover:bg-base-300/60 focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        {icon}{value}/day
      </span>
    </Tip>
  );
}

/** Ramp-up mirrors effectiveEmailLimit: 2 emails on day one, +2 a day, until the mailbox limit. */
function rampTip(limit: number, start: string | null): string {
  const days = Math.max(1, Math.ceil(limit / 2));
  const active = start ? Math.max(1, Math.floor((Date.now() - new Date(start).getTime()) / 86_400_000) + 1) : 1;
  const today = Math.min(limit, active * 2);
  return `Ramp-up active — quota gradually increases from 2 to ${limit} emails/day over ${days} days (today: ${today}/day).`;
}

/**
 * Compact agent header: name + status, then the senders with their daily limits, and one
 * primary outreach action. Less frequent controls (sourcing, launch now, delete) sit in a menu.
 */
export default function AgentHeader({ name, status, statusTip, outreachOn, senders, busy, onToggleOutreach, onToggleSourcing, onLaunch, onDelete, onSenderSettings }: {
  name: string; status: "active" | "paused" | "draft" | string; statusTip: string; outreachOn: boolean; senders: HeaderSenders; busy: boolean;
  onToggleOutreach: () => void; onToggleSourcing: () => void; onLaunch: () => void; onDelete: () => void; onSenderSettings: () => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const li = senders.linkedin;
  const mail = senders.email;
  const finding = status === "active";
  const isGmail = !!mail?.from_email && /@(gmail|googlemail)\.com$/i.test(mail.from_email);
  const items: MenuItem[] = [
    { label: finding ? "Pause lead sourcing" : "Resume lead sourcing", icon: <RiRadarLine size={15} />, onSelect: onToggleSourcing },
    { label: "Launch sources now", icon: <RiRocketLine size={15} />, onSelect: onLaunch, disabled: busy },
    { label: "Delete agent", icon: <RiDeleteBinLine size={15} />, onSelect: onDelete, danger: true },
  ];

  return (
    <div className="-mx-4 -mt-6 flex flex-col gap-4 px-4 pt-6 sm:flex-row sm:items-start sm:justify-between md:-mx-10 md:-mt-9 md:px-10 md:pt-8">
      <div className="min-w-0 space-y-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <RiFocus3Line size={24} className="shrink-0 text-primary" aria-hidden />
          <h1 className="min-w-0 truncate text-[24px] font-semibold leading-tight text-base-content" title={name}>{name}</h1>
          <Tip tip={statusTip}>
            <span tabIndex={0} className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[14.5px] font-medium outline-none ${finding ? "border-success/30 bg-success/10 text-success" : "border-[var(--border-subtle)] bg-base-200 text-base-content/60"}`}>
              {finding ? <RiLoader4Line size={13} className="animate-spin" /> : status === "draft" ? null : <RiPauseCircleLine size={13} />}
              {finding ? "Finding leads" : status === "draft" ? "Draft" : "Paused"}
            </span>
          </Tip>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-[36px] text-[15.5px] text-base-content/80">
          {li ? (
            <>
              <span className="inline-flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[14.5px] font-semibold text-primary-content">{(li.name ?? li.email ?? "?").trim()[0]?.toUpperCase()}</span>
                <span>{li.name ?? li.email}</span>
              </span>
              {li.is_authenticated ? (
                <>
                  <LimitChip icon={<RiUserAddLine size={13} />} value={li.daily_connection_limit ?? 20} title="LinkedIn invitations allowed" />
                  <LimitChip icon={<RiSendPlaneLine size={13} />} value={li.daily_message_limit ?? 40} title="LinkedIn messages allowed" />
                </>
              ) : (
                <Link href="/settings" className="inline-flex items-center gap-1 text-[14px] font-medium text-error hover:underline">
                  <RiLinkedinFill size={15} className="text-[#0a66c2]" /> Not connected <RiArrowRightLine size={14} />
                </Link>
              )}
            </>
          ) : (
            <button type="button" onClick={onSenderSettings} className="inline-flex items-center gap-1 font-medium text-error hover:underline">
              <RiLinkedinFill size={15} className="text-[#0a66c2]" /> Not connected <RiArrowRightLine size={14} />
            </button>
          )}

          <span className="hidden h-5 w-px bg-[var(--border-subtle)] sm:block" aria-hidden />

          {mail?.from_email ? (
            <>
              <Tip tip="Edit email sender settings">
                <button type="button" onClick={onSenderSettings} className="inline-flex min-w-0 items-center gap-2 transition-colors hover:text-primary">
                  {isGmail ? <SiGmail size={16} className="shrink-0 text-[#ea4335]" /> : <RiMailLine size={16} className="shrink-0 text-error" />}
                  <span className="truncate">{mail.from_email}</span>
                </button>
              </Tip>
              {!!mail.ramp_up_enabled && (
                <Tip tip={rampTip(mail.daily_email_limit ?? 30, mail.ramp_start_date)}>
                  <span tabIndex={0} className="inline-flex items-center gap-1.5 text-[14px] text-primary outline-none">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />Ramping up
                  </span>
                </Tip>
              )}
            </>
          ) : (
            <button type="button" onClick={onSenderSettings} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-dashed border-[var(--border-subtle)] px-3 text-[14.5px] text-base-content/55 hover:border-primary/40 hover:text-primary">
              <RiAddLine size={15} /> Add email sender
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {outreachOn
          ? <button className={secondaryBtn} onClick={onToggleOutreach}><RiPauseLine size={15} /> Pause outreach</button>
          : <button className={`${primaryBtn} shadow-[0_4px_12px_-4px_rgba(204,120,92,0.6)]`} onClick={onToggleOutreach}><RiPlayFill size={15} /> Start Outreach</button>}
        <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] text-base-content/50 hover:bg-base-200 hover:text-base-content" aria-label="More agent actions" aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => setMenu(menu ? null : e.currentTarget)}>
          <RiMore2Fill size={18} />
        </button>
        {menu && <FloatingMenu anchor={menu} items={items} onClose={() => setMenu(null)} label="Agent actions" width={220} />}
      </div>
    </div>
  );
}
