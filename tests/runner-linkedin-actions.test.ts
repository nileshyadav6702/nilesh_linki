import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/lib/db";
import {
  claimLinkedinAction, markLinkedinActionSent, markLinkedinActionAfterError, markTrackActionsUncertain,
  settledPriorAction, recoverStaleLinkedinActions, linkedinActionsToday, linkedinActionKey, claimTrack, releaseTrack,
  isAmbiguousSendError, type LinkedinActionInput,
} from "@/lib/linkedin/actions";

/**
 * Claim-before-send for LinkedIn. The step watchdog cannot cancel a Playwright send, and a
 * process can die between LinkedIn accepting a message and the track advancing; either way
 * the track used to stay due and the next tick sent the message again.
 */

const WS = "ws-li-actions";
let seq = 0;
function input(type: LinkedinActionInput["type"] = "message", account = "acct-li-1"): LinkedinActionInput {
  const n = ++seq;
  return { key: linkedinActionKey(type, `run-${n}`, `track-${n}`, `step-${n}`), type, accountId: account, runId: `run-${n}`, trackId: `track-${n}`, stepId: `step-${n}`, targetId: `t-${n}` };
}
const statusOf = (key: string) => (getDb().prepare("SELECT status FROM linkedin_actions WHERE idempotency_key = ?").get(key) as { status: string }).status;

beforeAll(() => {
  getDb().prepare("INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES (?, ?, ?)").run(WS, "LI actions", "li-actions");
});

describe("claim-before-send", () => {
  it("claims once, and a sent action is never claimed again", () => {
    const db = getDb();
    const i = input();
    const first = claimLinkedinAction(db, i);
    expect(first.claimed).toBe(true);
    if (first.claimed) markLinkedinActionSent(db, first.id);
    const again = claimLinkedinAction(db, i);
    expect(again).toMatchObject({ claimed: false, status: "sent" });
    expect(settledPriorAction(db, i.key)).toBe("sent");
  });

  it("does not resend after a timeout: a row left 'sending' becomes 'uncertain'", () => {
    const db = getDb();
    const i = input();
    expect(claimLinkedinAction(db, i).claimed).toBe(true);
    // The watchdog abandoned the step: nothing reported back. Next tick tries again.
    const retry = claimLinkedinAction(db, i);
    expect(retry).toMatchObject({ claimed: false, status: "uncertain" });
    expect(statusOf(i.key)).toBe("uncertain");
    // And it stays that way: uncertain is never auto-retried.
    expect(claimLinkedinAction(db, i)).toMatchObject({ claimed: false, status: "uncertain" });
  });

  it("the watchdog marks a timed-out track's in-flight action uncertain", () => {
    const db = getDb();
    const i = input();
    claimLinkedinAction(db, i);
    expect(markTrackActionsUncertain(db, i.trackId, "Step exceeded its 300s watchdog deadline")).toBe(1);
    expect(settledPriorAction(db, i.key)).toBe("uncertain");
  });

  it("an orphaned step that finishes later can still record the send, but never a failure", () => {
    const db = getDb();
    const sent = input();
    const a = claimLinkedinAction(db, sent);
    markTrackActionsUncertain(db, sent.trackId, "timeout");
    if (a.claimed) markLinkedinActionSent(db, a.id);
    expect(statusOf(sent.key)).toBe("sent");

    const failed = input();
    const b = claimLinkedinAction(db, failed);
    markTrackActionsUncertain(db, failed.trackId, "timeout");
    if (b.claimed) markLinkedinActionAfterError(db, b.id, new Error("Timeout 8000ms exceeded"));
    expect(statusOf(failed.key)).toBe("uncertain");
  });

  it("a known failure is retryable; a page/browser crash mid-send is uncertain", () => {
    const db = getDb();
    const known = input();
    const a = claimLinkedinAction(db, known);
    if (a.claimed) markLinkedinActionAfterError(db, a.id, new Error("locator.waitFor: Timeout 8000ms exceeded"));
    expect(statusOf(known.key)).toBe("failed");
    expect(settledPriorAction(db, known.key)).toBeNull();
    const retry = claimLinkedinAction(db, known);
    expect(retry.claimed).toBe(true);
    expect((db.prepare("SELECT attempt FROM linkedin_actions WHERE idempotency_key = ?").get(known.key) as { attempt: number }).attempt).toBe(2);

    const crashed = input();
    const b = claimLinkedinAction(db, crashed);
    expect(isAmbiguousSendError(new Error("page.waitForTimeout: Target page, context or browser has been closed"))).toBe(true);
    if (b.claimed) markLinkedinActionAfterError(db, b.id, new Error("Target page, context or browser has been closed"));
    expect(statusOf(crashed.key)).toBe("uncertain");
  });

  it("boot recovery quarantines old 'sending' rows only", () => {
    const db = getDb();
    const old = input();
    const fresh = input();
    claimLinkedinAction(db, old);
    claimLinkedinAction(db, fresh);
    db.prepare("UPDATE linkedin_actions SET updated_at = datetime('now', '-30 minutes') WHERE idempotency_key = ?").run(old.key);
    recoverStaleLinkedinActions(db, 10);
    expect(statusOf(old.key)).toBe("uncertain");
    expect(statusOf(fresh.key)).toBe("sending");
  });
});

describe("structured daily caps", () => {
  it("counts sent, sending and uncertain actions per account and type - not failed ones, not log text", () => {
    const db = getDb();
    const account = "acct-caps-1";
    const before = linkedinActionsToday(db, account, "connect", "UTC");
    const a = claimLinkedinAction(db, input("connect", account)); if (a.claimed) markLinkedinActionSent(db, a.id);
    claimLinkedinAction(db, input("connect", account)); // sending
    const c = claimLinkedinAction(db, input("connect", account)); if (c.claimed) markLinkedinActionAfterError(db, c.id, new Error("Connect option not found"));
    claimLinkedinAction(db, input("message", account)); // other type
    expect(linkedinActionsToday(db, account, "connect", "UTC")).toBe(before + 2);
    expect(linkedinActionsToday(db, account, "message", "UTC")).toBe(1);
  });

  it("keeps legacy log lines as a floor so upgrade day cannot double-spend", () => {
    const db = getDb();
    const account = "acct-caps-legacy";
    db.prepare("INSERT INTO accounts (id, name, email, workspace_id) VALUES (?, 'Legacy', 'legacy@li.test', ?)").run(account, WS);
    db.prepare("INSERT INTO runs (id, status, workspace_id, account_id) VALUES ('run-caps-legacy', 'running', ?, ?)").run(WS, account);
    for (let i = 0; i < 3; i++) {
      db.prepare("INSERT INTO logs (id, run_id, level, message) VALUES (?, 'run-caps-legacy', 'info', 'Message sent to Someone')").run(`log-legacy-${i}`);
    }
    expect(linkedinActionsToday(db, account, "message", "UTC")).toBe(3);
  });
});

describe("atomic track claims", () => {
  function seedTrack(id: string, step = 0) {
    const db = getDb();
    db.prepare("INSERT INTO runs (id, status, workspace_id) VALUES (?, 'running', ?)").run(`run-${id}`, WS);
    db.prepare("INSERT INTO targets (id, linkedin_url, workspace_id) VALUES (?, ?, ?)").run(`tgt-${id}`, `https://www.linkedin.com/in/${id}`, WS);
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES (?, ?, ?)").run(`rp-${id}`, `run-${id}`, `tgt-${id}`);
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES (?, ?, 'linkedin', 'in_progress', ?)").run(id, `rp-${id}`, step);
  }

  it("lets only one worker hold a track until it is released", () => {
    const db = getDb();
    seedTrack("claim-a");
    expect(claimTrack(db, "claim-a", "worker-1", 0)).toBe(true);
    expect(claimTrack(db, "claim-a", "worker-2", 0)).toBe(false);
    expect(claimTrack(db, "claim-a", "worker-1", 0)).toBe(false); // an orphaned step of the same worker too
    releaseTrack(db, "claim-a", "worker-2"); // not the holder: no effect
    expect(claimTrack(db, "claim-a", "worker-2", 0)).toBe(false);
    releaseTrack(db, "claim-a", "worker-1");
    expect(claimTrack(db, "claim-a", "worker-2", 0)).toBe(true);
  });

  it("refuses a track that moved since it was read, and reclaims a stale claim", () => {
    const db = getDb();
    seedTrack("claim-b", 2);
    expect(claimTrack(db, "claim-b", "worker-1", 1)).toBe(false); // someone advanced it
    expect(claimTrack(db, "claim-b", "worker-1", 2)).toBe(true);
    db.prepare("UPDATE run_profile_tracks SET claimed_at = datetime('now', '-30 minutes') WHERE id = 'claim-b'").run();
    expect(claimTrack(db, "claim-b", "worker-2", 2)).toBe(true);
  });
});
