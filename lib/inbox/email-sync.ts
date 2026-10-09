import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { addMessages, upsertThread, type MessageInput } from "@/lib/inbox/store";

/**
 * Pull a mailbox's recent inbox mail into the unified inbox. Gmail and Outlook mailboxes
 * connected with OAuth are read through their APIs; other mailboxes over IMAP. Mail from the
 * account's own address counts as outgoing.
 */

const RECENT = 50;

export interface RawMail {
  id: string; threadKey: string; subject: string | null; fromName: string | null; fromEmail: string | null; toEmail: string | null;
  date: string; text: string | null; html: string | null; unread: boolean;
}

interface Account {
  id: string; workspace_id: string; from_email: string | null; provider: string | null; oauth_connection_id: string | null;
  imap_host: string | null; imap_port: number | null; username: string; password: string; imap_username: string | null; imap_password: string | null; allow_self_signed: number | null;
}

/** "Re: Fwd: Hello" → "hello": the thread key for mailboxes without native thread ids. */
export function normalizeSubject(s: string | null | undefined): string {
  return (s ?? "").replace(/^\s*((re|fw|fwd|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, "").trim().toLowerCase();
}

/** "Jane Doe <jane@x.com>" → { name, email } */
export function parseAddress(v: string | null | undefined): { name: string | null; email: string | null } {
  if (!v) return { name: null, email: null };
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  const e = v.match(/[^\s<>"]+@[^\s<>"]+/);
  return { name: null, email: e ? e[0].toLowerCase() : null };
}

const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: Array<{ name: string; value: string }> }
function gmailBody(p: GmailPart | undefined, type: string): string | null {
  if (!p) return null;
  if (p.mimeType === type && p.body?.data) return b64(p.body.data);
  for (const c of p.parts ?? []) { const r = gmailBody(c, type); if (r) return r; }
  return null;
}

async function gmailFetch(token: string, path: string) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<Record<string, unknown>>;
}

async function readGmail(token: string, known: Set<string>): Promise<RawMail[]> {
  const list = await gmailFetch(token, `messages?labelIds=INBOX&maxResults=${RECENT}`);
  const out: RawMail[] = [];
  for (const m of (list.messages as Array<{ id: string; threadId: string }> | undefined) ?? []) {
    if (known.has(m.id)) continue;
    const full = await gmailFetch(token, `messages/${m.id}?format=full`) as { id: string; threadId: string; labelIds?: string[]; internalDate?: string; payload?: GmailPart };
    const h = (n: string) => full.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? null;
    const from = parseAddress(h("from"));
    out.push({
      id: full.id, threadKey: full.threadId, subject: h("subject"), fromName: from.name, fromEmail: from.email, toEmail: parseAddress(h("to")).email,
      date: new Date(Number(full.internalDate ?? Date.now())).toISOString(), text: gmailBody(full.payload, "text/plain"), html: gmailBody(full.payload, "text/html"),
      unread: (full.labelIds ?? []).includes("UNREAD"),
    });
  }
  return out;
}

async function readGraph(token: string, known: Set<string>): Promise<RawMail[]> {
  const r = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=${RECENT}&$orderby=receivedDateTime desc&$select=id,conversationId,subject,from,toRecipients,receivedDateTime,body,isRead`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Outlook ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json() as { value?: Array<{ id: string; conversationId: string; subject: string | null; from?: { emailAddress?: { name?: string; address?: string } }; toRecipients?: Array<{ emailAddress?: { address?: string } }>; receivedDateTime: string; body?: { contentType?: string; content?: string }; isRead?: boolean }> };
  return (d.value ?? []).filter((m) => !known.has(m.id)).map((m) => ({
    id: m.id, threadKey: m.conversationId, subject: m.subject, fromName: m.from?.emailAddress?.name ?? null, fromEmail: m.from?.emailAddress?.address?.toLowerCase() ?? null,
    toEmail: m.toRecipients?.[0]?.emailAddress?.address?.toLowerCase() ?? null, date: new Date(m.receivedDateTime).toISOString(),
    text: m.body?.contentType === "text" ? m.body.content ?? null : null, html: m.body?.contentType === "html" ? m.body.content ?? null : null, unread: m.isRead === false,
  }));
}

async function readImap(a: Account, known: Set<string>): Promise<RawMail[]> {
  const { default: Imap } = await import("imap");
  const { simpleParser } = await import("mailparser");
  const imap = new Imap({
    host: a.imap_host!, port: a.imap_port ?? 993, tls: true, tlsOptions: { rejectUnauthorized: a.allow_self_signed !== 1, servername: a.imap_host! },
    user: a.imap_username ?? a.username, password: decryptSecret(a.imap_password) ?? decryptSecret(a.password)!, authTimeout: 10_000, connTimeout: 12_000,
  });
  return new Promise<RawMail[]>((resolve, reject) => {
    const out: RawMail[] = [];
    const parsing: Array<Promise<void>> = [];
    imap.once("error", reject);
    imap.once("ready", () => imap.openBox("INBOX", true, (err, box) => {
      if (err) { imap.end(); return reject(err); }
      if (!box.messages.total) { imap.end(); return resolve([]); }
      const from = Math.max(1, box.messages.total - RECENT + 1);
      const f = imap.seq.fetch(`${from}:*`, { bodies: "", struct: false });
      f.on("message", (msg) => {
        let uid = 0; let flags: string[] = []; let thrid: string | null = null;
        msg.on("attributes", (attrs) => { uid = attrs.uid; flags = attrs.flags; thrid = (attrs as unknown as Record<string, string>)["x-gm-thrid"] ?? null; });
        msg.on("body", (stream) => {
          parsing.push(simpleParser(stream as unknown as import("stream").Readable).then((p) => {
            const id = p.messageId ?? `uid:${uid}`;
            if (known.has(id)) return;
            const fromAddr = p.from?.value?.[0];
            const to = Array.isArray(p.to) ? p.to[0] : p.to;
            out.push({
              id, threadKey: thrid ?? `${normalizeSubject(p.subject)}|${(fromAddr?.address ?? "").toLowerCase()}`, subject: p.subject ?? null,
              fromName: fromAddr?.name || null, fromEmail: fromAddr?.address?.toLowerCase() ?? null, toEmail: to?.value?.[0]?.address?.toLowerCase() ?? null,
              date: (p.date ?? new Date()).toISOString(), text: p.text ?? null, html: typeof p.html === "string" ? p.html : null, unread: !flags.includes("\\Seen"),
            });
          }, () => {}));
        });
      });
      f.once("error", (e) => { imap.end(); reject(e); });
      f.once("end", () => { void Promise.all(parsing).then(() => { imap.end(); resolve(out); }); });
    }));
    imap.connect();
  });
}

/** Group fetched mail into threads and store it. Exported for tests. */
export function storeMail(workspaceId: string, accountId: string, own: string | null, mails: RawMail[]): { threads: number; messages: number } {
  const db = getDb();
  const byThread = new Map<string, RawMail[]>();
  for (const m of mails) byThread.set(m.threadKey, [...(byThread.get(m.threadKey) ?? []), m]);
  let messages = 0;
  for (const [key, list] of byThread) {
    list.sort((x, y) => x.date.localeCompare(y.date));
    const last = list[list.length - 1];
    const other = list.find((m) => m.fromEmail && m.fromEmail !== own) ?? last;
    const t = upsertThread(db, {
      workspaceId, channel: "email", accountId, externalId: key, subject: last.subject, participantName: other.fromName ?? other.fromEmail,
      participantEmail: other.fromEmail !== own ? other.fromEmail : other.toEmail, snippet: (last.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || last.subject,
      lastMessageAt: last.date, unread: list.some((m) => m.unread),
    });
    const msgs: MessageInput[] = list.map((m) => ({
      externalId: m.id, direction: own && m.fromEmail === own ? "out" : "in", senderName: m.fromName, senderEmail: m.fromEmail,
      bodyText: m.text, bodyHtml: m.html, sentAt: m.date,
    }));
    messages += addMessages(db, t.id, msgs);
  }
  return { threads: byThread.size, messages };
}

export async function syncEmailMailbox(accountId: string): Promise<{ threads: number; messages: number }> {
  const db = getDb();
  const a = db.prepare(`SELECT id, workspace_id, from_email, provider, oauth_connection_id, imap_host, imap_port, username, password, imap_username, imap_password, allow_self_signed
    FROM email_accounts WHERE id = ?`).get(accountId) as Account | undefined;
  if (!a) return { threads: 0, messages: 0 };
  const known = new Set((db.prepare(`SELECT m.external_id FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE t.channel = 'email' AND t.account_id = ?`).all(accountId) as Array<{ external_id: string }>).map((r) => r.external_id));
  let mails: RawMail[];
  if (a.oauth_connection_id) {
    const { oauthAccessToken } = await import("@/lib/email/oauth");
    const { provider, token } = await oauthAccessToken(a.oauth_connection_id);
    mails = provider === "gmail" ? await readGmail(token, known) : await readGraph(token, known);
  } else if (a.imap_host) {
    mails = await readImap(a, known);
  } else {
    throw new Error("This mailbox has no IMAP settings, so its inbox can't be read");
  }
  return storeMail(a.workspace_id, a.id, (a.from_email ?? a.username)?.toLowerCase() ?? null, mails);
}
