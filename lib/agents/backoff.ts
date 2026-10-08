/**
 * In-process retry backoff for per-lead agent work (scoring, drafting) that failed. Keeps a
 * failing lead from being retried on every tick while the rest of the pass carries on.
 * Interim: state is lost on restart (a restart simply allows one early retry).
 */

export type BackoffStage = "score" | "draft";

const BASE_MS = 5 * 60_000;
const MAX_MS = 24 * 3_600_000;

const state = new Map<string, { attempts: number; until: number; error: string }>();
const keyOf = (stage: BackoffStage, targetId: string) => `${stage}:${targetId}`;

/** Records a failure; the next attempt waits 5m, 10m, 20m ... up to 24h. Returns the attempt count. */
export function recordFailure(stage: BackoffStage, targetId: string, error: string, now = Date.now()): number {
  const prev = state.get(keyOf(stage, targetId));
  const attempts = (prev?.attempts ?? 0) + 1;
  state.set(keyOf(stage, targetId), { attempts, until: now + Math.min(BASE_MS * 2 ** (attempts - 1), MAX_MS), error });
  return attempts;
}

export function inBackoff(stage: BackoffStage, targetId: string, now = Date.now()): boolean {
  const s = state.get(keyOf(stage, targetId));
  return !!s && s.until > now;
}

export function failureInfo(stage: BackoffStage, targetId: string): { attempts: number; until: number; error: string } | null {
  return state.get(keyOf(stage, targetId)) ?? null;
}

export function clearFailure(stage: BackoffStage, targetId: string): void {
  state.delete(keyOf(stage, targetId));
}

/** Test hook. */
export function resetBackoff(): void {
  state.clear();
}
