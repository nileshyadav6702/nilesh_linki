import { getDb } from "@/lib/db";
import type { AccountLimits, EmailAccountLimits, Target, TrackRun, WorkflowStep } from "../types";

/** Everything a step handler needs about the track, its target and the accounts it sends from. */
export interface StepContext {
  db: ReturnType<typeof getDb>;
  runId: string;
  tr: TrackRun;
  target: Target;
  steps: WorkflowStep[];
  step: WorkflowStep;
  /** Display name for logs: full name, else the LinkedIn URL. */
  name: string;
  accountId: string;
  accountLimits: AccountLimits;
  emailAccountId?: string | null;
  emailAccountLimits?: EmailAccountLimits | null;
  campaignPrompt?: string | null;
}
