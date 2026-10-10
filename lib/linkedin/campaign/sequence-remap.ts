import type Database from "better-sqlite3";

/**
 * Leads keep their place when a live sequence is edited. A track's current_step is a position
 * in its track's step list (the next step to run); saving an edit renumbers that list. Before
 * the save, each active track's next step is captured by id; after it, the position is
 * recomputed:
 *  - its next step still exists → the lead stays on it (wherever it moved);
 *  - it was deleted → the lead continues after the last step it already completed that still exists;
 *  - nothing left to run → the track completes, with a log line.
 * Steps added before a lead's position are not run for that lead (it is past that point); leads
 * that haven't started yet simply begin at the new first step.
 */

type DB = Database.Database;
export interface TrackPlace { id: string; runId: string; targetId: string; current: number; state: string; nextId: string | null; doneIds: string[] }

export function stepIds(db: DB, workflowId: string, track: string): string[] {
  return (db.prepare("SELECT id FROM workflow_steps WHERE workflow_id = ? AND track = ? ORDER BY step_order").all(workflowId, track) as Array<{ id: string }>).map((r) => r.id);
}

/** Where each active lead of this workflow/track stands, by step id. */
export function capturePlaces(db: DB, workflowId: string, track: string, oldIds: string[]): TrackPlace[] {
  const rows = db.prepare(`SELECT rt.id, rt.current_step, rt.state, rp.run_id, rp.target_id FROM run_profile_tracks rt
      JOIN run_profiles rp ON rp.id = rt.run_profile_id JOIN runs r ON r.id = rp.run_id
     WHERE r.workflow_id = ? AND rt.track = ? AND rt.state IN ('pending','in_progress')`).all(workflowId, track) as Array<{ id: string; current_step: number; state: string; run_id: string; target_id: string }>;
  return rows.map((r) => ({
    id: r.id, runId: r.run_id, targetId: r.target_id, current: r.current_step, state: r.state,
    nextId: oldIds[r.current_step] ?? null, doneIds: oldIds.slice(0, r.current_step),
  }));
}

/** The position a lead should be at in the new list (may equal its length: nothing left). */
export function newPosition(place: Pick<TrackPlace, "nextId" | "doneIds">, newIds: string[]): number {
  if (place.nextId) {
    const at = newIds.indexOf(place.nextId);
    if (at >= 0) return at;
  }
  const done = place.doneIds.map((id) => newIds.indexOf(id)).filter((i) => i >= 0);
  return done.length ? Math.max(...done) + 1 : 0;
}

/** Apply new positions after an edit (call inside the same transaction as the edit). */
export function applyPlaces(db: DB, places: TrackPlace[], newIds: string[]): { moved: number; completed: number } {
  const move = db.prepare("UPDATE run_profile_tracks SET current_step = ? WHERE id = ?");
  const finish = db.prepare("UPDATE run_profile_tracks SET state = 'completed', current_step = ?, next_step_at = NULL WHERE id = ? AND state = 'in_progress'");
  const log = db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (lower(hex(randomblob(16))), ?, ?, 'info', ?)");
  let moved = 0, completed = 0;
  for (const p of places) {
    // Not started yet: begins at the (new) first step.
    if (p.state === "pending") continue;
    const pos = newPosition(p, newIds);
    if (pos >= newIds.length && p.state === "in_progress") {
      if (finish.run(newIds.length, p.id).changes) {
        completed++;
        log.run(p.runId, p.targetId, "Sequence edited: no steps left for this lead — finished");
      }
      continue;
    }
    if (pos !== p.current) { move.run(Math.min(pos, newIds.length), p.id); moved++; }
  }
  return { moved, completed };
}
