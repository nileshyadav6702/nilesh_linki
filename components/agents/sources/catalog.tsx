import type { ReactNode } from "react";
import {
  RiCodeSSlashLine, RiFileCopy2Line, RiFocus3Line, RiGlobalLine, RiHashtag, RiHeart3Line, RiLinkedinFill, RiListUnordered, RiLineChartLine, RiUploadLine, RiUserVoiceLine,
} from "react-icons/ri";
import { countSignals, DRAWER_SIGNAL_TYPES, labelFromUrl, signalsFor, type DrawerSignalType, type SignalDraft } from "@/lib/agents/lead-source-rules";

/** The drawer's left-column items, their look and how each summarises its current config. */

export type ItemId = "competitor" | "topic" | "buying" | "tech" | "website" | "experts" | "engaging" | "lookalike" | "saved_list" | "csv" | "linkedin";
export type Drafts = Record<DrawerSignalType, SignalDraft>;

export interface ItemDef {
  id: ItemId; title: string; description: string; icon: ReactNode; tint: string;
  /** Source types this item edits; their signals add up in the badge. */
  types: DrawerSignalType[];
  soon?: boolean;
  /** Opens a modal instead of a panel. */
  modal?: boolean;
  summary: (d: Drafts, ctx: { lists: number }) => string;
}

const tile = (bg: string, fg: string) => `${bg} ${fg}`;
const join = (xs: string[], fallback: string) => xs.length ? xs.join(", ") : fallback;

export const LIVE_ITEMS: ItemDef[] = [
  { id: "competitor", title: "Competitor engagement", description: "Find people engaging with your competitors and surface the ones that match your ICP",
    icon: <RiFocus3Line size={18} />, tint: tile("bg-[#fde8e8]", "text-[#e0314b]"), types: ["competitor_engagement"],
    summary: (d) => join((d.competitor_engagement.config.urls ?? []).map(labelFromUrl), "Track people engaging with competitors") },
  { id: "topic", title: "Topic engagement", description: "Find people engaging with content relevant to your market and matching your ICP",
    icon: <RiHashtag size={18} />, tint: tile("bg-[#efe8fd]", "text-[#7c3aed]"), types: ["keyword_engagement"],
    summary: (d) => join(d.keyword_engagement.config.keywords ?? [], "People engaging with topics you track") },
  { id: "buying", title: "Buying events", description: "Find people and companies showing signals that make now a good time to reach out",
    icon: <RiLineChartLine size={18} />, tint: tile("bg-[#fdf3d8]", "text-[#d97706]"), types: ["top_active", "job_change", "new_decision_maker", "funding", "hiring", "hiring_surge"],
    summary: (d) => join([
      d.top_active.enabled && "Track top 5% active profiles in your ICP", d.job_change.enabled && "Recent job changes", d.new_decision_maker.enabled && "New decision-makers",
      d.funding.enabled && "Recently raised funds", d.hiring.enabled && "Job openings", d.hiring_surge.enabled && "Hiring surge",
    ].filter((x): x is string => !!x), "Job changes, funding rounds, hiring") },
  { id: "tech", title: "Tech stack", description: "Find companies using specific technologies and surface matching prospects",
    icon: <RiCodeSSlashLine size={18} />, tint: tile("bg-[#e3f5ea]", "text-[#16a34a]"), types: ["tech_stack"],
    summary: (d) => join(d.tech_stack.enabled ? d.tech_stack.config.keywords ?? [] : [], "Companies using technologies you track") },
  { id: "website", title: "Website visitors", description: "Visitors, or people at companies visiting your website",
    icon: <RiGlobalLine size={18} />, tint: tile("bg-base-200", "text-base-content/45"), types: [], soon: true,
    summary: () => "Visitors, or people at visiting companies" },
  { id: "experts", title: "Industry experts", description: "Find prospects engaging with experts in your market",
    icon: <RiUserVoiceLine size={18} />, tint: tile("bg-[#e3f5ea]", "text-[#16a34a]"), types: ["influencer_engagement"],
    summary: (d) => join((d.influencer_engagement.config.urls ?? []).map(labelFromUrl), "People engaging with experts in your market") },
  { id: "engaging", title: "People engaging with you", description: "Find prospects already engaging with you or your company",
    icon: <RiHeart3Line size={18} />, tint: tile("bg-[#fde8f1]", "text-[#db2777]"), types: ["own_content_engagement", "profile_visitors", "company_followers"],
    summary: (d) => join([d.own_content_engagement.enabled && "Post engagement", d.profile_visitors.enabled && "Profile visitors", d.company_followers.enabled && "Company page followers"]
      .filter((x): x is string => !!x), "People engaging with you or your company") },
  { id: "lookalike", title: "Lookalike", description: "Find prospects similar to your best customers",
    icon: <RiFileCopy2Line size={18} />, tint: tile("bg-[#efe8fd]", "text-[#7c3aed]"), types: ["lookalike"],
    summary: () => "Find prospects similar to your best customers" },
];

export const IMPORT_ITEMS: ItemDef[] = [
  { id: "saved_list", title: "Saved list", description: "Add the leads of a list you already have in Kairo to this campaign.",
    icon: <RiListUnordered size={18} />, tint: tile("bg-base-200", "text-base-content/70"), types: [],
    summary: (_d, c) => c.lists ? `${c.lists} list${c.lists === 1 ? "" : "s"} attached` : "Use a list already in Kairo" },
  { id: "csv", title: "CSV file", description: "Upload a list of contacts", icon: <RiUploadLine size={18} />, tint: tile("bg-base-200", "text-base-content/70"), types: [], modal: true,
    summary: () => "Upload a list of contacts" },
  { id: "linkedin", title: "LinkedIn import", description: "Import people from LinkedIn", icon: <RiLinkedinFill size={18} />, tint: tile("bg-[#0a66c2]/10", "text-[#0a66c2]"), types: [], modal: true,
    summary: () => "Import people from LinkedIn" },
];

export const itemSignals = (item: ItemDef, d: Drafts) => item.types.reduce((n, t) => n + signalsFor(t, d[t]), 0);
export const totalSignals = (d: Drafts) => countSignals(d);

/** Config fields the drawer edits; anything else on the stored row is left alone server-side. */
const pick = (c: Record<string, unknown>): SignalDraft["config"] => ({
  urls: Array.isArray(c.urls) ? c.urls as string[] : [],
  keywords: Array.isArray(c.keywords) ? c.keywords as string[] : [],
  boards: Array.isArray(c.boards) ? c.boards as NonNullable<SignalDraft["config"]["boards"]> : [],
  role_keywords: Array.isArray(c.role_keywords) ? c.role_keywords as string[] : [],
});

export function draftsFromRows(rows: Array<{ source_type: string; enabled: number; config_json: string }>): Drafts {
  const out = {} as Drafts;
  for (const t of DRAWER_SIGNAL_TYPES) {
    const row = rows.find((r) => r.source_type === t);
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(row?.config_json || "{}"); } catch { /* bad row → empty */ }
    out[t] = { enabled: !!row?.enabled, config: pick(cfg) };
  }
  return out;
}

export const sameDraft = (a: SignalDraft, b: SignalDraft) => JSON.stringify(a) === JSON.stringify(b);
export const changedTypes = (initial: Drafts, draft: Drafts) => DRAWER_SIGNAL_TYPES.filter((t) => !sameDraft(initial[t], draft[t]));
