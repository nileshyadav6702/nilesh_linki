import { getDb } from "@/lib/db";

// Header parsing and reply attribution for the IMAP sync (lib/email/inbox.ts).

export const BOUNCE_SENDER_PATTERNS = [
  /mailer-daemon@/i,
  /postmaster@/i,
  /mail-delivery-subsystem@/i,
  /delivery-status@/i,
  /amazonses\.com$/i,
];

export function extractEmails(text: string): string[] {
  return [...text.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)].map(m => m[0].toLowerCase());
}

export function isBounce(fromEmail: string): boolean {
  return BOUNCE_SENDER_PATTERNS.some(p => p.test(fromEmail));
}

export function hashStr(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function parseHeaderValue(raw: string, field: string): string {
  const regex = new RegExp(`^${field}:[ \\t]*(.+?)(?=\\r?\\n[^\\s]|$)`, "im");
  const m = raw.match(regex);
  if (!m) return "";
  return m[1].replace(/\r?\n[\t ]+/g, " ").trim();
}

export interface PendingTarget {
  id: string;
  email: string;
  /** First / latest send to this contact from the mailbox being synced (SQLite UTC text). */
  first_sent: string | null;
  last_sent: string | null;
}

export interface ScannedHeader {
  uid: number;
  from: string;
  /** Epoch ms the message arrived (INTERNALDATE, else its Date header); null if unknown. */
  date: number | null;
  /** Message-IDs from In-Reply-To and References. */
  refs: string[];
}

export const REPLY_SCAN_FIELDS = "HEADER.FIELDS (FROM DATE IN-REPLY-TO REFERENCES)";
// Tolerance between our clock (when the send was recorded) and the mail server's (when the
// reply arrived): an instant auto-reply must not be dropped as "older than the first email".
const REPLY_CLOCK_SKEW_MS = 2 * 60_000;

/** SQLite `datetime('now')` text is UTC without a zone marker; ISO strings pass through. */
export function parseDbTime(value: string | null): number | null {
  if (!value) return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Sender, arrival time and threading references from one header-scan entry. */
export function parseScannedHeader(raw: string, uid: number, internalDate: Date | null): ScannedHeader | null {
  const fromRaw = parseHeaderValue(raw, "From");
  const emailMatch = fromRaw.match(/<([^>]+)>/) ?? fromRaw.match(/([^\s]+@[^\s]+)/);
  const from = emailMatch?.[1]?.toLowerCase().trim();
  if (!from) return null;
  // INTERNALDATE is the server's arrival time; the Date header is sender-controlled.
  const headerDate = Date.parse(parseHeaderValue(raw, "Date"));
  const date = internalDate && Number.isFinite(internalDate.getTime())
    ? internalDate.getTime()
    : Number.isFinite(headerDate) ? headerDate : null;
  const refs = Array.from(new Set(
    `${parseHeaderValue(raw, "In-Reply-To")} ${parseHeaderValue(raw, "References")}`.match(/<[^<>\s]+>/g) ?? [],
  ));
  return { uid, from, date, refs };
}

/**
 * Decide which pending contact each scanned message is a reply to, and return the newest such
 * message per contact. Rules:
 *  - A message that references (In-Reply-To/References) a campaign email this mailbox sent is a
 *    reply to THAT email's contact, whatever address it came from.
 *  - Otherwise a message from a contact's address is a reply only if it arrived after this
 *    mailbox's first email to that contact; earlier mail is just mail. When several pending
 *    contacts share the address, the one this mailbox emailed most recently gets it.
 */
export function attributeReplies(db: ReturnType<typeof getDb>, input: {
  workspaceId: string;
  emailAccountId: string;
  scanned: ScannedHeader[];
  targetsByEmail: Map<string, PendingTarget[]>;
  pendingById: Map<string, PendingTarget>;
}): Map<string, { uid: number; from: string }> {
  const { workspaceId, emailAccountId, scanned, targetsByEmail, pendingById } = input;

  // Referenced Message-ID -> the contact our message went to. Looked up only for the IDs the
  // scan actually saw, in bounded chunks, on the (workspace_id, message_id) index.
  const sentById = new Map<string, { target_id: string; accepted_at: string }>();
  const allRefs = Array.from(new Set(scanned.flatMap((m) => m.refs)));
  for (let i = 0; i < allRefs.length; i += 500) {
    const chunk = allRefs.slice(i, i + 500);
    const rows = db.prepare(`
      SELECT sm.message_id, sm.target_id, sm.accepted_at FROM sent_messages sm
      JOIN email_jobs ej ON ej.id = sm.job_id
      WHERE sm.workspace_id = ? AND sm.email_account_id = ? AND ej.source = 'campaign'
        AND sm.target_id IS NOT NULL AND sm.message_id IN (${chunk.map(() => "?").join(",")})
    `).all(workspaceId, emailAccountId, ...chunk) as Array<{ message_id: string; target_id: string; accepted_at: string }>;
    for (const r of rows) sentById.set(r.message_id, r);
  }

  const latest = new Map<string, { uid: number; from: string }>();
  const attribute = (targetId: string, m: ScannedHeader) => {
    const prev = latest.get(targetId);
    if (!prev || m.uid > prev.uid) latest.set(targetId, { uid: m.uid, from: m.from });
  };

  for (const m of scanned) {
    // 1. Threading headers name the exact email being answered.
    const referenced = new Set<string>();
    for (const ref of m.refs) {
      const sent = sentById.get(ref);
      if (!sent || !pendingById.has(sent.target_id)) continue;
      const sentAt = parseDbTime(sent.accepted_at);
      if (m.date !== null && sentAt !== null && m.date + REPLY_CLOCK_SKEW_MS < sentAt) continue;
      referenced.add(sent.target_id);
    }
    if (referenced.size > 0) {
      for (const id of referenced) attribute(id, m);
      continue;
    }

    // 2. Sender address, only for mail that arrived after our first email to that contact.
    const arrived = m.date;
    if (arrived === null) continue;
    const eligible = (targetsByEmail.get(m.from) ?? []).filter((t) => {
      const first = parseDbTime(t.first_sent);
      return first !== null && arrived + REPLY_CLOCK_SKEW_MS >= first;
    });
    if (eligible.length === 0) continue;
    const chosen = eligible.reduce((best, t) => ((parseDbTime(t.last_sent) ?? 0) > (parseDbTime(best.last_sent) ?? 0) ? t : best));
    attribute(chosen.id, m);
  }
  return latest;
}
