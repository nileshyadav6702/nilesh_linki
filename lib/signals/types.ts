/** Every signal type the engine understands, with its default intent weight (0-100). */
export const SIGNAL_TYPES = {
  competitor_engagement: { label: "Engaged with a competitor", weight: 30, linkedin: true },
  influencer_engagement: { label: "Engaged with an influencer", weight: 20, linkedin: true },
  keyword_engagement: { label: "Active on a topic", weight: 25, linkedin: true },
  own_content_engagement: { label: "Engaged with your content", weight: 35, linkedin: true },
  job_change: { label: "Changed jobs", weight: 25, linkedin: true },
  hiring: { label: "Company is hiring", weight: 20, linkedin: false },
  funding: { label: "Company raised funding", weight: 25, linkedin: false },
  website_visit: { label: "Visited your website", weight: 40, linkedin: false },
  lookalike: { label: "Looks like your best leads", weight: 5, linkedin: true },
  top_active: { label: "Top 5% most active in your ICP", weight: 20, linkedin: true },
  new_decision_maker: { label: "New decision-maker in role", weight: 25, linkedin: true },
  hiring_surge: { label: "Hiring surge", weight: 25, linkedin: false },
  profile_view: { label: "Viewed your profile", weight: 40, linkedin: true },
  company_follow: { label: "Follows your company page", weight: 30, linkedin: true },
  // Pre-existing API types, kept for compatibility.
  technology: { label: "Uses a relevant technology", weight: 15, linkedin: false },
  product_intent: { label: "Product intent", weight: 30, linkedin: false },
  custom: { label: "Custom signal", weight: 10, linkedin: false },
} as const;

export type SignalType = keyof typeof SIGNAL_TYPES;

export function isSignalType(value: unknown): value is SignalType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SIGNAL_TYPES, value);
}

export function signalWeight(type: string): number {
  return isSignalType(type) ? SIGNAL_TYPES[type].weight : 10;
}

export function signalLabel(type: string): string {
  return isSignalType(type) ? SIGNAL_TYPES[type].label : type;
}

/** Source types an agent can run. Each maps to the signal type it emits. */
export const SOURCE_TYPES = {
  competitor_engagement: { signal: "competitor_engagement", needsLinkedIn: true, configHint: "LinkedIn company or profile URLs of competitors" },
  influencer_engagement: { signal: "influencer_engagement", needsLinkedIn: true, configHint: "LinkedIn profile URLs of creators your buyers follow" },
  own_content_engagement: { signal: "own_content_engagement", needsLinkedIn: true, configHint: "Your LinkedIn profile and company page URLs" },
  keyword_engagement: { signal: "keyword_engagement", needsLinkedIn: true, configHint: "Topics your buyers post about" },
  job_change: { signal: "job_change", needsLinkedIn: true, configHint: "Re-checks contacts already in this agent's list" },
  hiring: { signal: "hiring", needsLinkedIn: false, configHint: "Greenhouse / Lever / Ashby board slugs + role keywords" },
  funding: { signal: "funding", needsLinkedIn: false, configHint: "News RSS feeds announcing funding rounds" },
  lookalike: { signal: "lookalike", needsLinkedIn: true, configHint: "Imports people matching the ICP from Sales Navigator" },
  top_active: { signal: "top_active", needsLinkedIn: false, configHint: "People matching the ICP who post on LinkedIn most often" },
  new_decision_maker: { signal: "new_decision_maker", needsLinkedIn: false, configHint: "People matching the ICP who started their role in the last 90 days" },
  hiring_surge: { signal: "hiring_surge", needsLinkedIn: false, configHint: "Job boards (from Job openings) whose open roles jump" },
  tech_stack: { signal: "technology", needsLinkedIn: false, configHint: "Technologies, detected on the websites of companies matching the ICP" },
  profile_visitors: { signal: "profile_view", needsLinkedIn: true, configHint: "People who viewed the agent's LinkedIn profile (Premium)" },
  company_followers: { signal: "company_follow", needsLinkedIn: true, configHint: "Followers of your company page (page admins only)" },
  existing_list: { signal: "custom", needsLinkedIn: false, configHint: "Leads from your existing lists or CSV imports" },
  linkedin_import: { signal: "lookalike", needsLinkedIn: false, configHint: "A Sales Navigator list or search URL to import" },
} as const;

export type SourceType = keyof typeof SOURCE_TYPES;

export function isSourceType(value: unknown): value is SourceType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SOURCE_TYPES, value);
}
