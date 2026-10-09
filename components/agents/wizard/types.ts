import type { SourceDraft } from "@/components/agents/SourcePicker";
import type { Icp } from "@/lib/icp/schema";

export type SourceKind = "signals" | "lookalike" | "existing" | "linkedin_import";

export interface OutreachChoice {
  /** null until the user picks how to build the sequence. */
  build: "ai" | "manual" | null;
  channel: "linkedin" | "multi" | "email";
  goal: "conversations" | "meetings";
  tone: "professional" | "conversational" | "direct";
  workflow_id: string;
  linkedin_account_id: string;
  email_account_id: string;
  exclude_first_degree: boolean;
  mode: "copilot" | "autopilot";
  booking_url: string;
  daily_lead_cap: number;
}

export interface WizardState {
  name: string;
  website: string;
  icp: Icp;
  icpId: string | null;
  sourceKind: SourceKind | null;
  sources: SourceDraft[];
  listIds: string[];
  importUrl: string;
  /** Minimum lead score: broad 40, balanced 55, high precision 70. */
  minScore: number;
  agentId: string | null;
  outreach: OutreachChoice;
}

/** The agent's sources for the chosen kind, in the shape POST /api/agents expects. */
export function sourcesFor(s: WizardState): Array<{ source_type: string; config: Record<string, unknown> }> {
  // The lookalike runner reads the ICP's Sales Navigator query itself.
  if (s.sourceKind === "lookalike") return [{ source_type: "lookalike", config: {} }];
  if (s.sourceKind === "existing") return [{ source_type: "existing_list", config: { list_ids: s.listIds } }];
  if (s.sourceKind === "linkedin_import") return [{ source_type: "linkedin_import", config: { urls: [s.importUrl] } }];
  return s.sources.filter((x) => x.enabled).map((x) => ({ source_type: x.source_type, config: x.config as Record<string, unknown> }));
}
