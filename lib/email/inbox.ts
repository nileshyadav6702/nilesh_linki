import Imap from "imap";
import { classifyDsn, parseFeedbackReport } from "@/lib/email/send-errors";
import { getDb } from "@/lib/db";
import { premium } from "@/lib/premium";
import { decryptSecret } from "@/lib/crypto";

const IMAP_POLL_INTERVAL_MS = 5 * 60 * 1000; // push/IDLE fallback reconciliation
// Ceiling on one full IMAP session (connect + header scan + bounce scan). Generous:
// it exists to break a hang, not to cut short a large but progressing mailbox scan.
const SESSION_DEADLINE_MS = 90 * 1000;

// How far back a reply can arrive and still be detected. Reply detection reads the FROM
// headers of everything in this window in ONE fetch, so the window costs bandwidth, not
// round trips — unlike the old per-lead SEARCH, whose cost scaled with the campaign.
const REPLY_LOOKBACK_DAYS = 120;
// Ceiling on how many recent messages one pass reads headers for. A mailbox busier than this
// is scanned newest-first; anything older is picked up by the bounce scan or the next pass.
const MAX_HEADER_SCAN = 3000;
// Mailboxes swept at once by the workspace sweep. Sequential meant an 18-mailbox workspace
// waited for the sum of every mailbox; unbounded would open 18 IMAP sessions and 18 TLS
// handshakes at once and hand the origin exactly the load spike that returns 502s.
const ACCOUNT_SWEEP_CONCURRENCY = 4;

import {
  BOUNCE_SENDER_PATTERNS, attributeReplies, extractEmails, hashStr, isBounce, parseDbTime,
  parseHeaderValue, parseScannedHeader, REPLY_SCAN_FIELDS, type PendingTarget, type ScannedHeader,
} from "@/lib/email/reply-attribution";
import { captureReplyBody } from "@/lib/email/reply-capture";
import { applyBounceCandidates } from "@/lib/email/bounces";
import { recordProviderEvent } from "@/lib/email/infrastructure";

export { attributeReplies, parseScannedHeader, REPLY_SCAN_FIELDS, captureReplyBody, applyBounceCandidates };
export type { PendingTarget, ScannedHeader };


interface EmailAccount {
  id: string;
  workspace_id: string;
  from_email: string | null;
  imap_host: string | null;
  imap_port: number | null;
  username: string;
  password: string;
  imap_username: string | null;
  imap_password: string | null;
  allow_self_signed: number;
  inbox_synced_at: string | null;
}


export function shouldSyncEmailInbox(emailAccountId: string): boolean {
  const db = getDb();
  const account = db
    .prepare("SELECT inbox_synced_at FROM email_accounts WHERE id = ?")
    .get(emailAccountId) as { inbox_synced_at: string | null } | undefined;
  if (!account?.inbox_synced_at) return true;
  return Date.now() - new Date(account.inbox_synced_at).getTime() >= IMAP_POLL_INTERVAL_MS;
}

/**
 * Opens one IMAP connection, then for each lead that has been emailed but
 * not yet replied, runs a server-side FROM search. Only touches the mailbox
 * index — never downloads message bodies for reply detection.
 *
 * Also scans the last 50 messages for bounces (mailer-daemon etc.).
 */
export async function syncEmailInbox(emailAccountId: string): Promise<{ replies: number; bounces: number }> {
  const db = getDb();

  const account = db
    .prepare("SELECT id, workspace_id, from_email, imap_host, imap_port, username, password, imap_username, imap_password, allow_self_signed, inbox_synced_at FROM email_accounts WHERE id = ?")
    .get(emailAccountId) as EmailAccount | undefined;

  if (!account?.imap_host) {
    console.warn(`[email-inbox] Account ${emailAccountId} has no IMAP config — skipping`);
    return { replies: 0, bounces: 0 };
  }

  // Contacts CURRENTLY OR PREVIOUSLY IN A CAMPAIGN that we emailed from this account and
  // who haven't replied yet. The inbox is a campaign-reply inbox only — never warmup,
  // never manual/one-off sends. Two campaign sources, unioned: (a) leads enrolled in a
  // campaign email step, and (b) campaign emails recorded in the durable mail plane
  // (source='campaign'), so replies still surface after a run is deleted.
  // `IS NOT 'invalid'` is null-safe: a contact with an unset email_status is NOT excluded.
  // Each contact carries its first and latest send FROM THIS MAILBOX (sent_messages, with
  // email_jobs as the fallback for a send whose receipt row is missing): mail from a contact
  // that predates our first email is not a reply, and when several contacts share an address
  // the one emailed most recently is the one a reply answers. Scoped to the mailbox's workspace.
  const pendingTargets = db.prepare(`
    WITH pending AS (
    SELECT DISTINCT t.id, t.email FROM targets t
    JOIN run_profiles rp ON rp.target_id = t.id
    JOIN run_profile_tracks rt ON rt.run_profile_id = rp.id
    WHERE t.email IS NOT NULL
      AND t.email_replied_at IS NULL
      AND t.email_status IS NOT 'invalid'
      AND rt.track = 'email'
      AND rt.state NOT IN ('pending')
      AND rp.email_account_id = ?
      AND t.workspace_id = ?
    UNION
    SELECT DISTINCT t.id, t.email FROM targets t
    JOIN email_jobs ej ON ej.target_id = t.id
    WHERE t.email IS NOT NULL
      AND t.email_replied_at IS NULL
      AND t.email_status IS NOT 'invalid'
      AND ej.email_account_id = ?
      AND ej.source = 'campaign'
      AND ej.status = 'sent'
      AND t.workspace_id = ?
    ),
    sent AS (
      SELECT target_id, MIN(accepted_at) first_sent, MAX(accepted_at) last_sent FROM sent_messages
      WHERE email_account_id = ? AND target_id IS NOT NULL GROUP BY target_id
    ),
    jobs AS (
      SELECT target_id, MIN(updated_at) first_sent, MAX(updated_at) last_sent FROM email_jobs
      WHERE email_account_id = ? AND status = 'sent' AND target_id IS NOT NULL GROUP BY target_id
    )
    SELECT p.id, p.email,
      COALESCE(s.first_sent, j.first_sent) first_sent, COALESCE(s.last_sent, j.last_sent) last_sent
    FROM pending p LEFT JOIN sent s ON s.target_id = p.id LEFT JOIN jobs j ON j.target_id = p.id
  `).all(emailAccountId, account.workspace_id, emailAccountId, account.workspace_id, emailAccountId, emailAccountId) as PendingTarget[];

  if (pendingTargets.length === 0) {
    db.prepare("UPDATE email_accounts SET inbox_synced_at = datetime('now') WHERE id = ?").run(emailAccountId);
    return { replies: 0, bounces: 0 };
  }

  console.log(`[email-inbox] Checking ${pendingTargets.length} leads via one IMAP header scan`);

  const imapUser = account.imap_username ?? account.username;
  const imapPass = decryptSecret(account.imap_password) ?? decryptSecret(account.password)!;

  // Every address this workspace sends from. A DSN quotes the original message, so our own
  // sending addresses appear in the body of practically every bounce — they must never be
  // mistaken for the bounced recipient and suppressed.
  const ourAddresses = new Set(
    (db.prepare("SELECT lower(from_email) e FROM email_accounts WHERE workspace_id = ? AND from_email IS NOT NULL").all(account.workspace_id) as { e: string }[])
      .map(r => r.e)
      .concat([account.username.toLowerCase()]),
  );

  let replies = 0;
  let bounces = 0;

  await new Promise<void>((resolve) => {
    const imap = new Imap({
      host: account.imap_host!,
      port: account.imap_port ?? 993,
      tls: true,
      tlsOptions: {
        rejectUnauthorized: account.allow_self_signed !== 1,
        servername: account.imap_host!,
      },
      user: imapUser,
      password: imapPass,
      authTimeout: 10_000,
      connTimeout: 12_000,
    });

    // `done` must be idempotent and must be reachable from EVERY exit path. This promise
    // previously resolved only via the success path or an `error` event: `authTimeout` and
    // `connTimeout` cover connect and auth only, so once `ready` fired a stalled TLS stream
    // left the per-lead search loop awaiting a callback that never came, and the promise
    // never settled. That single hang froze the whole campaign runner for two days.
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try { imap.end(); } catch { /* ignore */ }
      resolve();
    };

    // Hard ceiling on the whole session, independent of the caller's own watchdog, so this
    // is safe even when invoked directly (the "Check for replies now" button).
    const deadline = setTimeout(() => {
      console.warn(`[email-inbox] IMAP session for account ${emailAccountId} exceeded ${SESSION_DEADLINE_MS / 1000}s — abandoning`);
      try { imap.destroy(); } catch { /* ignore */ }
      done();
    }, SESSION_DEADLINE_MS);
    deadline.unref?.();

    imap.once("error", (err: Error) => {
      console.warn(`[email-inbox] IMAP error for account ${emailAccountId}:`, err.message);
      done();
    });

    // A socket that closes mid-command resolves nothing on its own — without these the
    // pending search callback is simply orphaned.
    imap.once("end", done);
    imap.once("close", done);

    imap.once("ready", () => {
      imap.openBox("INBOX", true, async (err, box) => {
        if (err || !box) { console.warn("[email-inbox] openBox failed:", err?.message); done(); return; }

        // ── Reply detection: ONE header scan answers the whole pending set ────
        // This was previously one IMAP SEARCH per pending lead, serialised over the single
        // connection the protocol gives us: a campaign with 400 leads meant 400 round trips
        // per mailbox, and an 18-mailbox workspace took ~16 minutes for what is seconds of
        // real work — while pinning the origin hard enough to return 502s to everything else.
        // One `SEARCH SINCE` plus one headers-only FETCH answers the same question for every
        // lead at once, so the cost scales with recent mailbox traffic, not with campaign size.
        //
        // The tradeoff is the lookback window: a reply older than REPLY_LOOKBACK_DAYS is no
        // longer detected, where the per-lead search scanned the mailbox back to its first
        // message. Replies that old are not actionable, and the window is far wider than any
        // sequence's follow-up horizon.
        const pendingById = new Map(pendingTargets.map((t) => [t.id, t]));
        // Several contacts can share an address (re-imports, two campaigns, a shared inbox):
        // keep them all, and decide per message which one it answers.
        const targetsByEmail = new Map<string, PendingTarget[]>();
        for (const t of pendingTargets) {
          const key = t.email.toLowerCase();
          targetsByEmail.set(key, [...(targetsByEmail.get(key) ?? []), t]);
        }

        // Nothing can be a reply before the earliest first send to a pending contact, so the
        // window starts there (less a day: SINCE is date-granular) when that is later than the
        // lookback ceiling. No recorded send at all means nothing to match.
        const firstSends = pendingTargets.map((t) => parseDbTime(t.first_sent)).filter((n): n is number => n !== null);
        const since = new Date(Math.max(Date.now() - REPLY_LOOKBACK_DAYS * 86_400_000, Math.min(...firstSends, Date.now()) - 86_400_000));
        const candidateUids = firstSends.length === 0 ? [] : await new Promise<number[]>((resSearch) => {
          imap.search([["SINCE", since]], (searchErr, uids) => resSearch(searchErr || !uids ? [] : uids));
        });

        // Newest-first cap: a mailbox with more recent mail than one pass will read gets its
        // newest slice now and the remainder on the next pass.
        const scanUids = candidateUids.slice(-MAX_HEADER_SCAN);

        // Header fields only: FROM for address matching, DATE as a fallback when the server
        // gives no INTERNALDATE, and IN-REPLY-TO/REFERENCES to tie a reply sent from another
        // address (an alias, a colleague, an assistant) to the message it answers.
        const scanned: ScannedHeader[] = [];

        if (scanUids.length > 0) {
          await new Promise<void>((resScan) => {
            const fetch = imap.fetch(scanUids, { bodies: REPLY_SCAN_FIELDS, struct: false });
            const pending: Promise<void>[] = [];

            fetch.on("message", (msg) => {
              let uid = 0;
              let internalDate: Date | null = null;
              msg.on("attributes", (attrs) => {
                uid = attrs.uid;
                internalDate = attrs.date instanceof Date ? attrs.date : null;
              });
              // Settled on the message's own `end`, never on the body stream's.
              //
              // `attributes` is what carries the UID, and it arrives *after* the body
              // stream ends. Finishing on body-end therefore read `uid` while it was
              // still 0 -- and the tick this deferred message-end by was precisely what
              // guaranteed body-end won that race. Every detected reply then asked
              // captureReplyBody to fetch UID 0, which node-imap rejects outright:
              // "UID/seqno must be greater than zero". Replies were detected and none
              // were ever stored.
              //
              // `end` fires for every message including one that emits no body part, so
              // it keeps the property the race was reaching for -- a bodyless message
              // cannot strand the batch -- while guaranteeing the UID is in hand.
              pending.push(new Promise<void>((resMsg) => {
                const chunks: Buffer[] = [];
                let handled = false;
                const finish = () => {
                  if (handled) return;
                  handled = true;
                  // A UID of 0 means the attributes never arrived; capture cannot work
                  // from it, so leave the message out rather than record an unusable one.
                  // Our own mail and DSNs are never replies (DSNs often carry In-Reply-To).
                  const header = parseScannedHeader(Buffer.concat(chunks).toString(), uid, internalDate);
                  if (header && uid > 0 && !ourAddresses.has(header.from) && !isBounce(header.from)
                      && (targetsByEmail.has(header.from) || header.refs.length > 0)) {
                    scanned.push(header);
                  }
                  resMsg();
                };
                msg.on("body", (stream) => {
                  stream.on("data", (c: Buffer) => chunks.push(c));
                });
                msg.once("end", () => setImmediate(finish));
              }));
            });

            fetch.once("error", () => resScan());
            fetch.once("end", () => { void Promise.allSettled(pending).then(() => resScan()); });
          });
        }

        // target id -> newest (highest UID) message attributed to it
        const latestByTarget = attributeReplies(db, {
          workspaceId: account.workspace_id, emailAccountId, scanned, targetsByEmail, pendingById,
        });

        for (const [targetId, hit] of latestByTarget) {
          const target = pendingById.get(targetId)!;
          const via = hit.from !== target.email.toLowerCase() ? ` (sent from ${hit.from})` : "";
          console.log(`[email-inbox] Reply detected for ${target.email} (target ${target.id})${via}`);
          replies++;

          // Capture the body, then let the classifier+dispatcher decide the action.
          // We no longer eagerly stamp email_replied_at here — the dispatcher does it
          // for skip-buckets (call_task / human_reply / not_interested) but leaves it
          // unset for OOO follow-ups so the runner keeps the contact enrolled.
          // On any failure the contact stays enrolled (safe fallback, plan §3.2).
          try {
            const replyId = await captureReplyBody(imap, db, target.id, hit.from, hit.uid, emailAccountId);
            // The reply is always stored. Classification and automatic follow-up
            // run only when a reply processor is configured.
            if (replyId && premium?.replies) {
              await premium.replies.classifyAndDispatch(replyId);
            }
          } catch (err) {
            console.warn(`[email-inbox] Failed to capture/dispatch reply for ${target.email}:`, err);
          }
        }

        // ── Bounce detection: scan last 50 messages for mailer-daemon ─────────
        if (box.messages.total > 0) {
          const total = box.messages.total;
          const start = Math.max(1, total - 49);
          const range = `${start}:${total}`;

          await new Promise<void>((resFetch) => {
            const fetch = imap.seq.fetch(range, {
              // MESSAGE-ID identifies the DSN itself, which is what makes recording it
              // idempotent. Sequence numbers cannot serve that purpose — they shift as mail
              // arrives, and this range is re-read on every poll.
              bodies: ["HEADER.FIELDS (FROM TO MESSAGE-ID DATE SUBJECT)", "TEXT"],
              struct: false,
            });

            type RawMsg = { header: string; body: string };
            const msgs: RawMsg[] = [];

            fetch.on("message", (msg) => {
              const entry: RawMsg = { header: "", body: "" };
              msg.on("body", (stream, info) => {
                const chunks: Buffer[] = [];
                stream.on("data", (c: Buffer) => chunks.push(c));
                stream.once("end", () => {
                  const text = Buffer.concat(chunks).toString();
                  if (info.which.startsWith("HEADER")) entry.header = text;
                  else entry.body = text.slice(0, 3000);
                });
              });
              msg.once("end", () => msgs.push(entry));
            });

            fetch.once("error", () => resFetch());
            fetch.once("end", () => {
              for (const msg of msgs) {
                const fromRaw = parseHeaderValue(msg.header, "From");
                const toRaw = parseHeaderValue(msg.header, "To");

                const emailMatch = fromRaw.match(/<([^>]+)>/) ?? fromRaw.match(/([^\s]+@[^\s]+)/);
                const fromEmail = emailMatch?.[1]?.toLowerCase().trim();
                // A spam complaint from the provider's feedback loop (ARF): record it, which suppresses
                // the address and counts toward the mailbox's complaint rate (auto-pause).
                const report = msg.body ? parseFeedbackReport(msg.body) : null;
                if (report?.recipient) {
                  recordProviderEvent({ workspaceId: account.workspace_id, provider: "arf",
                    providerEventId: parseHeaderValue(msg.header, "Message-ID") || `arf:${report.recipient}:${report.messageId ?? ""}`,
                    eventType: "complained", recipient: report.recipient, messageId: report.messageId ?? undefined });
                  continue;
                }
                if (!fromEmail || !isBounce(fromEmail)) continue;
                // Only a permanent failure is a bounce: delay notices and soft bounces (4.x.x, mailbox
                // full) must not suppress the address or count against the mailbox.
                if (classifyDsn(parseHeaderValue(msg.header, "Subject"), msg.body) !== "hard") continue;

                const dsnMessageId = parseHeaderValue(msg.header, "Message-ID") || `seq-fallback:${hashStr(msg.header + msg.body)}`;

                // Also extract Final-Recipient from DSN bodies (SES bounce format)
                const finalRecipient = msg.body.match(/Final-Recipient:\s*rfc822;\s*([^\s\r\n]+)/i)?.[1] ?? "";
                // Final-Recipient is the DSN's own statement of which address failed, so it
                // outranks a scrape of the body — the body also contains our own sending
                // address, the postmaster, and anything quoted from the original message.
                const authoritative = finalRecipient.trim().toLowerCase();
                const scraped = extractEmails(msg.body + " " + toRaw + " " + finalRecipient);
                const candidates = authoritative && !BOUNCE_SENDER_PATTERNS.some(p => p.test(authoritative))
                  ? [authoritative, ...scraped.filter(c => c !== authoritative)]
                  : scraped;

                bounces += applyBounceCandidates(db, {
                  account, emailAccountId, dsnMessageId, authoritative, candidates, ourAddresses,
                });
              }
              resFetch();
            });
          });
        }

        done();
      });
    });

    imap.connect();
  });

  // Stamped on every outcome, including a timeout or a connection error. This is a THROTTLE,
  // not a success marker: when it was only advanced on success, a mailbox that hung left it
  // untouched, so the next poll retried immediately and hung again — the stall reproduced
  // itself across restarts. A persistently broken mailbox now backs off to one attempt per
  // IMAP_POLL_INTERVAL_MS instead of monopolising every pass.
  db.prepare("UPDATE email_accounts SET inbox_synced_at = datetime('now') WHERE id = ?").run(emailAccountId);
  return { replies, bounces };
}


/** Every email account with IMAP configured (used by the always-on poller). */
export function listImapEmailAccountIds(workspaceId?: string): string[] {
  const db = getDb();
  const rows = workspaceId
    ? db.prepare("SELECT id FROM email_accounts WHERE workspace_id = ? AND imap_host IS NOT NULL AND imap_host != ''").all(workspaceId)
    : db.prepare("SELECT id FROM email_accounts WHERE imap_host IS NOT NULL AND imap_host != ''").all();
  return (rows as { id: string }[]).map((r) => r.id);
}

/**
 * Re-attaches replies that lost their contact (the contact was deleted) to a contact in the
 * same workspace with the same email address — which is what recreating a deleted contact
 * produces, under a new id. Without this, a reply captured before the deletion stays detached
 * forever: it is not re-ingested (the message is already stored, by Message-ID) and it is not
 * filed against the new contact (nothing ever looked).
 *
 * Matching is on email address only, and only within the reply's own workspace.
 * Returns the number of replies re-linked.
 */
export function relinkDetachedReplies(workspaceId: string): number {
  const db = getDb();
  const result = db.prepare(`
    UPDATE email_replies
    SET target_id = (
      SELECT t.id FROM targets t
      WHERE t.workspace_id = email_replies.workspace_id
        AND lower(t.email) = lower(email_replies.from_email)
      ORDER BY t.created_at DESC LIMIT 1
    )
    WHERE workspace_id = ?
      AND target_id IS NULL
      AND EXISTS (
        SELECT 1 FROM targets t
        WHERE t.workspace_id = email_replies.workspace_id
          AND lower(t.email) = lower(email_replies.from_email)
      )
  `).run(workspaceId);
  if (result.changes > 0) {
    console.log(`[email-inbox] Re-linked ${result.changes} detached repl${result.changes === 1 ? "y" : "ies"} in workspace ${workspaceId}`);
  }
  return result.changes;
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Immediately sync every IMAP-configured account in a workspace, ignoring the
 * per-account throttle. Backs the manual "Check for replies now" button.
 */
export async function syncWorkspaceEmailInboxes(workspaceId: string): Promise<{ accounts: number; replies: number; bounces: number; relinked: number; skipped_no_imap: number; no_imap_accounts: Array<{ id: string; from_email: string }>; warning?: string }> {
  const ids = listImapEmailAccountIds(workspaceId);
  // Senders that can send but have no IMAP — silently excluded from reply detection. Surface
  // them so a mailbox that can't receive replies is visible rather than a quiet account drop.
  const noImap = getDb().prepare("SELECT id, from_email FROM email_accounts WHERE workspace_id = ? AND (imap_host IS NULL OR imap_host = '')").all(workspaceId) as Array<{ id: string; from_email: string }>;

  // Before touching IMAP: anything already stored but detached that now has a matching
  // contact again is filed immediately, with no mailbox round trip at all.
  let relinked = relinkDetachedReplies(workspaceId);

  let replies = 0;
  let bounces = 0;
  // Mailboxes are independent, so they sweep in parallel — but capped, because 18 concurrent
  // IMAP sessions is itself a load spike on the origin. Counters are only touched after each
  // await, and Node runs this on one thread, so the increments cannot interleave.
  await mapWithConcurrency(ids, ACCOUNT_SWEEP_CONCURRENCY, async (id) => {
    try {
      const r = await syncEmailInbox(id);
      replies += r.replies;
      bounces += r.bounces;
    } catch (e) {
      console.warn(`[email-inbox] workspace sync error for account ${id}:`, e instanceof Error ? e.message : e);
    }
  });

  // And again afterwards: a reply captured during this sweep for a contact that was deleted
  // mid-flight is detached on insert and would otherwise wait for the next sweep.
  relinked += relinkDetachedReplies(workspaceId);

  return {
    accounts: ids.length,
    replies,
    bounces,
    relinked,
    skipped_no_imap: noImap.length,
    no_imap_accounts: noImap,
    ...(noImap.length ? { warning: `${noImap.length} sender(s) have no IMAP and cannot receive replies: ${noImap.map(a => a.from_email).join(", ")}` } : {}),
  };
}
