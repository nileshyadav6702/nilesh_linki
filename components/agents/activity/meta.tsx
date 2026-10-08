import type { ReactNode } from "react";
import {
  RiAddCircleLine, RiArrowGoBackLine, RiChat3Line, RiCheckboxCircleLine, RiErrorWarningLine, RiEyeLine, RiGlobalLine, RiLoader4Line, RiMailLine, RiMailSendLine,
  RiMicLine, RiRadarLine, RiReplyLine, RiRobot2Line, RiSearchLine, RiSendPlaneLine, RiSettings3Line, RiThumbUpLine, RiUserAddLine, RiUserFollowLine,
} from "react-icons/ri";
import { IMPORT_ITEMS, LIVE_ITEMS, type ItemId } from "@/components/agents/sources/catalog";
import { timeAgo } from "@/components/agents/ui";
import type { ActivityCategory, OutcomeIcon, OutcomeTone } from "@/lib/agents/activity-feed";

/** Labels, icons and formatting shared by the Activity feed's chips and rows. */

export type ActivityFilter = "all" | ActivityCategory;
export const FILTERS: ActivityFilter[] = ["all", "website", "discovery", "campaign", "setup"];

export const CATEGORY: Record<ActivityCategory, { label: string; icon: (size: number) => ReactNode }> = {
  website: { label: "Website visitors", icon: (s) => <RiGlobalLine size={s} /> },
  discovery: { label: "Lead discovery", icon: (s) => <RiSearchLine size={s} /> },
  campaign: { label: "Campaign", icon: (s) => <RiSendPlaneLine size={s} /> },
  setup: { label: "Setup", icon: (s) => <RiSettings3Line size={s} /> },
};

/** Source types and setup kinds → the icon the Lead sources catalog uses for them. */
const CATALOG_ID: Record<string, ItemId> = { existing_list: "saved_list", linkedin_import: "linkedin", csv: "csv", website: "website" };
const SETUP_MARK: Record<string, ReactNode> = {
  agent: <RiRobot2Line size={18} />, campaign: <RiAddCircleLine size={18} />, settings: <RiSettings3Line size={18} />,
  sources: <RiRadarLine size={18} />, source: <RiRadarLine size={18} />,
};

export function markIcon(mark: string): ReactNode {
  const items = [...LIVE_ITEMS, ...IMPORT_ITEMS];
  const item = items.find((i) => (i.types as string[]).includes(mark)) ?? items.find((i) => i.id === CATALOG_ID[mark]);
  return item?.icon ?? SETUP_MARK[mark] ?? <RiRadarLine size={18} />;
}

const OUTCOME_ICON: Record<OutcomeIcon, ReactNode> = {
  invite: <RiUserAddLine size={17} />, accepted: <RiUserFollowLine size={17} />, message: <RiChat3Line size={17} />, inmail: <RiMailSendLine size={17} />,
  email: <RiMailLine size={17} />, reply: <RiReplyLine size={17} />, enriched: <RiMailLine size={17} />, qualified: <RiCheckboxCircleLine size={17} />,
  visit: <RiEyeLine size={17} />, like: <RiThumbUpLine size={17} />, voice: <RiMicLine size={17} />, withdraw: <RiArrowGoBackLine size={17} />,
  error: <RiErrorWarningLine size={17} />, running: <RiLoader4Line size={17} className="animate-spin" />, website: <RiGlobalLine size={17} />,
};
export const outcomeIcon = (i: OutcomeIcon | null) => (i ? OUTCOME_ICON[i] : null);

export const TONE_TEXT: Record<OutcomeTone, string> = {
  positive: "text-success", neutral: "text-base-content/75", warning: "text-warning", negative: "text-error",
};

/** "3m", "9h", "2d": the feed's compact relative time. */
export const shortAgo = (iso: string) => timeAgo(iso).replace(/ ago$/, "");

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Day group header: Today, Yesterday, a weekday this week, else the date. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}
