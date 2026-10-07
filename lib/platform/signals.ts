import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { emitDomainEvent } from "@/lib/platform/events";
import { ensureGlobalRunnerStarted } from "@/lib/linkedin/runner";
import { isSignalType, signalWeight } from "@/lib/signals/types";
import { recomputeIntent } from "@/lib/signals/scoring";

export interface SignalInput {
  workspaceId: string; targetId?: string; companyId?: string; type: string; title: string;
  description?: string; score?: number; source?: string; occurredAt?: string; metadata?: unknown;
  agentId?: string; sourceUrl?: string; snippet?: string; detectorRunId?: string;
  /** Stable key for idempotent ingestion (e.g. `post:<urn>:<member>`). A repeat is ignored. */
  dedupeKey?: string;
}

export function ingestSignal(input: SignalInput) {
  const db = getDb();
  if (input.dedupeKey) {
    const existing = db.prepare("SELECT * FROM signals WHERE workspace_id = ? AND dedupe_key = ?").get(input.workspaceId, input.dedupeKey);
    if (existing) return existing;
  }
  const id = randomUUID();
  // Unknown types are kept as 'custom' with the original name in metadata, rather than rejected.
  const type = isSignalType(input.type) ? input.type : "custom";
  const metadata = type === input.type
    ? input.metadata ?? {}
    : { ...(typeof input.metadata === "object" && input.metadata ? input.metadata : {}), original_type: input.type };
  // An explicit score (API callers) is the signal's weight; detectors use the type default.
  const weight = Number(input.score ?? 0) > 0 ? Math.min(100, Number(input.score)) : signalWeight(type);
  db.prepare(`INSERT INTO signals (id, workspace_id, target_id, company_id, type, title, description, score, source, occurred_at, metadata_json,
      agent_id, source_url, snippet, weight, detector_run_id, dedupe_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.workspaceId, input.targetId ?? null, input.companyId ?? null, type, input.title, input.description ?? null,
      input.score ?? weight, input.source ?? "api", input.occurredAt ?? new Date().toISOString(), JSON.stringify(metadata),
      input.agentId ?? null, input.sourceUrl ?? null, input.snippet ?? null, weight, input.detectorRunId ?? null, input.dedupeKey ?? null);
  if (input.targetId) {
    recomputeIntent(db, input.targetId);
    applySignalRules(input.workspaceId, input.targetId, type, input.score ?? weight);
  }
  emitDomainEvent({ workspaceId: input.workspaceId, type: "signal.received", entityType: "signal", entityId: id, payload: { ...input, type } });
  return db.prepare("SELECT * FROM signals WHERE id = ?").get(id);
}

function applySignalRules(workspaceId: string, targetId: string, type: string, score: number) {
  const db = getDb();
  const rules = db.prepare(`SELECT * FROM signal_rules WHERE workspace_id = ? AND enabled = 1
    AND signal_type = ? AND min_score <= ?`).all(workspaceId, type, score) as Array<Record<string, unknown>>;
  for (const rule of rules) {
    // Isolate each rule: a single misconfigured rule (e.g. a workflow deleted out from under
    // it, or a bad reference) must not abort the loop or break signal ingestion for the rest.
    try {
      if (rule.list_id) db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)").run(rule.list_id, targetId);
      if (!rule.workflow_id || !rule.account_id || !rule.list_id) continue;
      // Skip if the referenced workflow/list/account no longer exist (avoids FK errors and
      // enrolling into a dangling run).
      const refsOk = db.prepare(`SELECT
          EXISTS(SELECT 1 FROM workflows WHERE id = ? AND workspace_id = ?) w,
          EXISTS(SELECT 1 FROM lists WHERE id = ? AND workspace_id = ?) l,
          EXISTS(SELECT 1 FROM accounts WHERE id = ? AND workspace_id = ?) a`)
        .get(rule.workflow_id, workspaceId, rule.list_id, workspaceId, rule.account_id, workspaceId) as { w: number; l: number; a: number };
      if (!refsOk.w || !refsOk.l || !refsOk.a) continue;
      let run = db.prepare("SELECT id, status FROM runs WHERE workspace_id = ? AND workflow_id = ? AND status IN ('pending','running','paused') ORDER BY created_at DESC LIMIT 1").get(workspaceId, rule.workflow_id) as { id: string; status: string } | undefined;
      if (!run) {
        run = { id: randomUUID(), status: Number(rule.auto_start) ? "running" : "pending" };
        db.prepare("INSERT INTO runs (id, workspace_id, workflow_id, list_id, account_id, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(run.id, workspaceId, rule.workflow_id, rule.list_id, rule.account_id, run.status, run.status === "running" ? new Date().toISOString() : null);
      }
      const enrolled = db.prepare("SELECT 1 FROM run_profiles WHERE run_id = ? AND target_id = ?").get(run.id, targetId);
      if (!enrolled) {
        const profileId = randomUUID();
        db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES (?, ?, ?)").run(profileId, run.id, targetId);
        const tracks = db.prepare("SELECT DISTINCT track FROM workflow_steps WHERE workflow_id = ?").all(rule.workflow_id) as Array<{ track: string }>;
        const insert = db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, ?, 'pending', 0)");
        for (const track of tracks.length ? tracks : [{ track: "linkedin" }]) if (track.track !== "email") insert.run(randomUUID(), profileId, track.track);
      }
      if (run.status === "running") ensureGlobalRunnerStarted();
    } catch (err) {
      console.warn(`[signals] rule ${String(rule.id)} failed to apply:`, err instanceof Error ? err.message : err);
    }
  }
}

