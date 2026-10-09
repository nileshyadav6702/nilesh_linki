/** Shapes and option lists shared by the Leads table, toolbar and filter popover. */

export interface StepRef { type: string; order: number; label: string; accepted?: boolean }
export interface Outreach { track: string; state: string; prev: StepRef | null; next: StepRef | null; waiting: string | null; next_at: string | null }
export interface LeadSignal { id: string; type: string; title: string; snippet: string | null; source_url: string | null; metadata_json?: string | null; occurred_at: string; weight?: number | null }

export interface LeadRowData {
  id: string; full_name: string | null; profile_image_url?: string | null; headline: string | null; title: string | null; company: string | null; linkedin_url: string | null;
  email: string | null; email_status: string | null; email_unsubscribed?: boolean; phone: string | null; outreach_step: string | null; outreach: Outreach | null;
  lead_score: number | null; intent_score: number; fit_reason: string | null; fit_verdict: string | null; replied?: boolean;
  agent_status: string | null; agent_name: string | null; created_at: string;
  signals: LeadSignal[]; signal_count?: number;
  score_breakdown?: string | null; company_logo?: string | null; company_domain?: string | null; company_industry?: string | null;
  drafts: Array<{ id: string }>;
}

export interface Facets {
  status: Record<string, number>;
  step: Record<string, number>;
  signal: Array<{ type: string; count: number }>;
}

export interface Filters { status: string; step: string; approval: string; email: string; phone: string; signal: string; sort: string }
export const DEFAULT_SORT = "score_desc";
export const DEFAULT_FILTERS: Filters = { status: "all", step: "", approval: "", email: "", phone: "", signal: "", sort: DEFAULT_SORT };

export type Option = { value: string; label: string };

export const STATUS_OPTIONS: Option[] = [
  { value: "all", label: "All" }, { value: "drafted", label: "To review" }, { value: "scheduled", label: "Scheduled" },
  { value: "in_sequence", label: "In sequence" }, { value: "replied", label: "Replied" }, { value: "qualified", label: "Qualified" },
  { value: "needs_data", label: "Needs data" }, { value: "disqualified", label: "Not a fit" }, { value: "skipped", label: "Rejected" },
];
export const STEP_OPTIONS: Option[] = [
  { value: "", label: "All" }, { value: "not_contacted", label: "Not contacted yet" }, { value: "invitation_sent", label: "Invitation sent" },
  { value: "invitation_accepted", label: "Invitation accepted" }, { value: "message_sent", label: "Message sent" },
  { value: "inmail_sent", label: "InMail sent" }, { value: "email_sent", label: "Email sent" }, { value: "replied", label: "Replied" },
];
export const APPROVAL_OPTIONS: Option[] = [
  { value: "", label: "All" }, { value: "pending", label: "Pending review" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" },
];
export const EMAIL_OPTIONS: Option[] = [
  { value: "", label: "All contacts" }, { value: "found", label: "Email found" }, { value: "not_found", label: "Email not found" },
  { value: "not_enriched", label: "Email not enriched yet" }, { value: "unsubscribed", label: "Unsubscribed" },
];
export const PHONE_OPTIONS: Option[] = [
  { value: "", label: "All contacts" }, { value: "found", label: "Phone found" }, { value: "not_found", label: "Phone not found" }, { value: "not_enriched", label: "Phone not enriched yet" },
];
export const SORT_OPTIONS: Option[] = [
  { value: "newest", label: "Newest first" }, { value: "score_desc", label: "Score: High to Low" }, { value: "score_asc", label: "Score: Low to High" },
  { value: "signal_desc", label: "Signal: Newest to Oldest" }, { value: "signal_asc", label: "Signal: Oldest to Newest" },
];

export const labelOf = (opts: Option[], v: string) => opts.find((o) => o.value === v)?.label ?? v;
