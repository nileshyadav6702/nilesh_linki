import { useState, type ReactNode } from "react";
import Link from "next/link";
import { SiGmail } from "react-icons/si";
import {
  RiAddLine, RiArrowRightLine, RiDeleteBinLine, RiFocus3Line, RiInformationLine, RiLinkedinFill, RiMailLine, RiMore2Fill,
  RiPauseCircleLine, RiPauseLine, RiPlayFill, RiRadarLine, RiRocketLine, RiSendPlaneLine, RiUserAddLine,
} from "react-icons/ri";
import { FloatingMenu, type MenuItem } from "@/components/agents/leads/Menu";
import { primaryBtn } from "@/components/agents/ui";

export interface HeaderSenders {
  linkedin: {
    name: string | null; email: string | null; daily_connection_limit: number | null; daily_message_limit: number | null; is_authenticated: number;
    weekly_connection_limit?: number | null; weekly_message_limit?: number | null; working_days?: string | null;
  } | null;
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

function LimitChip({ icon, value, weekly, title }: { icon: ReactNode; value: number; weekly: number; title: string }) {
  return (
    <Tip tip={<><div className="text-[16px] font-semibold text-base-content">{title}</div><div className="tabular-nums">{value}/day · {weekly} /week</div></>}>
      <span tabIndex={0} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-base-200 px-2.5 text-[15.5px] tabular-nums text-base-content/60 outline-none hover:bg-base-300/60 focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        {icon}{value}/day
      </span>
    </Tip>
  );
}

/** Weekly quota for a daily cap: the saved weekly limit, else the daily cap over the active days. */
const weeklyOf = (daily: number, weekly: number | null | undefined, days: string | null | undefined) =>
  weekly ?? daily * Math.max(1, String(days || "1,2,3,4,5").split(",").filter(Boolean).length);

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
export default function AgentHeader({ name, status, statusTip, outreachOn, senders, busy, nextLaunch, onToggleOutreach, onToggleSourcing, onLaunch, onDelete, onSenderSettings }: {
  name: string; status: "active" | "paused" | "draft" | string; statusTip: string; outreachOn: boolean; senders: HeaderSenders; busy: boolean;
  /** "Next launch in 12 hours" under the outreach button; `when` is shown bold. */
  nextLaunch?: { lead: string; when: string; tip: string } | null;
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
            <span tabIndex={0} className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-[6px] px-3 text-[16px] font-medium outline-none ${finding ? "bg-[#5cc49a] text-white" : status === "draft" ? "bg-base-200 text-base-content/60" : "bg-[#e8a55a]/20 text-[#b8742a]"}`}>
              {finding ? <span className="h-2 w-2 rounded-full bg-white" /> : status === "draft" ? null : <RiPauseCircleLine size={15} />}
              {finding ? "Active" : status === "draft" ? "Draft" : "Paused"}
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
                  <LimitChip icon={<RiUserAddLine size={16} />} value={li.daily_connection_limit ?? 20} weekly={weeklyOf(li.daily_connection_limit ?? 20, li.weekly_connection_limit, li.working_days)} title="LinkedIn invitations allowed" />
                  <LimitChip icon={<RiSendPlaneLine size={16} />} value={li.daily_message_limit ?? 40} weekly={weeklyOf(li.daily_message_limit ?? 40, li.weekly_message_limit, li.working_days)} title="LinkedIn messages allowed" />
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

      <div className="flex shrink-0 flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <button className={`${primaryBtn} !h-12 !bg-[#f4876b] !px-5 !text-[16.5px] shadow-[0_6px_16px_-6px_rgba(232,112,82,0.7)] hover:!bg-[#ee7357]`} onClick={onToggleOutreach}>
          {outreachOn ? <><RiPauseLine size={18} /> Pause Outreach</> : <><RiPlayFill size={18} /> Start Outreach</>}
        </button>
        <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] text-base-content/50 hover:bg-base-200 hover:text-base-content" aria-label="More agent actions" aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => setMenu(menu ? null : e.currentTarget)}>
          <RiMore2Fill size={18} />
        </button>
        {menu && <FloatingMenu anchor={menu} items={items} onClose={() => setMenu(null)} label="Agent actions" width={220} />}
      </div>
      {nextLaunch && (
        <Tip tip={nextLaunch.tip}>
          <span tabIndex={0} className="inline-flex items-center gap-1.5 pr-12 text-[15.5px] text-base-content/60 outline-none">
            {nextLaunch.lead} <b className="font-semibold text-base-content/80">{nextLaunch.when}</b>
            <RiInformationLine size={16} className="text-base-content/45" />
          </span>
        </Tip>
      )}
      </div>
    </div>
  );
}
