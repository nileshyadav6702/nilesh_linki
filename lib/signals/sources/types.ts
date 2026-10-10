import type Database from "better-sqlite3";
import type { BrowserContext } from "playwright";
import type { Agent, AgentSource, SourceConfig } from "@/lib/agents/store";
import type { Icp } from "@/lib/icp/schema";
import type { VoyagerLike } from "@/lib/linkedin/engagers";
import type { LeadCandidate } from "@/lib/signals/leads";
import type { SignalType } from "@/lib/signals/types";

export interface EmittedSignal {
  type: SignalType;
  title: string;
  snippet?: string | null;
  sourceUrl?: string | null;
  /** Globally stable per (event, person), so re-running a detector never double-counts. */
  dedupeKey: string;
  occurredAt?: string | null;
  metadata?: Record<string, unknown>;
}

export type EmitResult = "ingested" | "filtered" | "duplicate" | "capped";

export interface SourceRunContext {
  db: Database.Database;
  workspaceId: string;
  agent: Agent;
  source: AgentSource;
  config: SourceConfig;
  icp: Icp | null;
  detectorRunId: string;
  /** Present for LinkedIn-backed sources. */
  voyager?: VoyagerLike;
  browser?: BrowserContext;
  /** A newly discovered person + why they matter. */
  emitLead(candidate: LeadCandidate, signal: EmittedSignal, opts?: { excludeEmployeesOf?: string[] }): EmitResult;
  /** A signal about a contact already in the workspace. */
  emitForTarget(targetId: string, signal: EmittedSignal): EmitResult;
  /** A company-level signal; fans out to known contacts at that company. */
  emitForCompany(company: { name: string; domain?: string | null; website?: string | null }, signal: EmittedSignal): EmitResult;
  /** True once a preview run has collected enough leads; runners should stop early. */
  isFull(): boolean;
  /** Persisted per-source state between runs. */
  cursor: Record<string, unknown>;
  /** The scheduler's hint for low-yield items: read less (fewer posts, engagers, search rows). */
  lean?: boolean;
}

export type SourceRunner = (ctx: SourceRunContext) => Promise<void>;
