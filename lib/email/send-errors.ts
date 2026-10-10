/**
 * What a failed send or a bounce notice means, from SMTP codes rather than message text:
 *  - mailbox-level problems (login, quota, throttling) belong to the MAILBOX: pause / cool it
 *    down and hold the contacts, instead of failing every due contact one by one;
 *  - a recipient rejected at RCPT TO is a hard bounce for that address, never retried;
 *  - a send is "uncertain" only if it failed at or after handing over the message (DATA).
 */

export type SendFailure =
  | { kind: "mailbox_auth"; reason: string }
  | { kind: "mailbox_throttled"; reason: string }
  | { kind: "recipient_rejected"; reason: string }
  | { kind: "uncertain"; reason: string }
  | { kind: "retry"; reason: string };

interface SmtpLike { code?: string; responseCode?: number; command?: string; response?: string; message?: string }

const QUOTA = /quota exceeded|sending quota|daily (user )?sending limit|sending limit exceeded|too many (messages|emails|recipients|connections)|rate.?limit|5\.4\.5|4\.7\.0 .*(rate|limit|too many)/i;
const AUTH = /authentication (failed|unsuccessful|credentials)|invalid (login|credentials)|username and password not accepted|5\.7\.8|535|534|application-specific password|basic authentication is disabled|invalid_grant|token (has been )?(expired|revoked)/i;
const BAD_RECIPIENT = /5\.1\.[0-9]|user unknown|no such user|mailbox (unavailable|not found|does not exist)|recipient (address )?rejected|address rejected|does not exist|invalid recipient|unknown recipient/i;

export function classifySendError(error: unknown): SendFailure {
  const e = (error ?? {}) as SmtpLike;
  const text = `${e.response ?? ""} ${e.message ?? String(error)}`;
  const command = (e.command ?? "").toUpperCase();
  const code = e.responseCode ?? 0;
  if (e.code === "EAUTH" || command.startsWith("AUTH") || code === 535 || code === 534 || (AUTH.test(text) && !BAD_RECIPIENT.test(text))) {
    return { kind: "mailbox_auth", reason: `The mailbox login was refused: ${text.trim().slice(0, 200)}` };
  }
  if (QUOTA.test(text) || ((code === 421 || code === 450 || code === 452) && /rate|limit|too many|quota/i.test(text))) {
    return { kind: "mailbox_throttled", reason: `The mail provider is limiting this mailbox: ${text.trim().slice(0, 200)}` };
  }
  if ((command === "RCPT TO" || command === "RCPT") && (code >= 550 || BAD_RECIPIENT.test(text))) {
    return { kind: "recipient_rejected", reason: text.trim().slice(0, 300) };
  }
  if (code >= 550 && code < 560 && BAD_RECIPIENT.test(text)) return { kind: "recipient_rejected", reason: text.trim().slice(0, 300) };
  // Only a failure at or after DATA may have delivered the message.
  const network = ["ETIMEDOUT", "ECONNRESET", "EPIPE", "ESOCKET"].includes(e.code ?? "") || /timeout|connection.*closed|socket/i.test(text);
  if (network && (command === "DATA" || command === "" || command === "API")) return { kind: "uncertain", reason: text.trim().slice(0, 300) };
  return { kind: "retry", reason: text.trim().slice(0, 300) };
}

export type DsnKind = "hard" | "soft" | "delay";

/** A delivery status notification: permanent failure, soft (retryable / mailbox full) or just a delay notice. */
export function classifyDsn(subject: string, body: string): DsnKind {
  const action = body.match(/^\s*Action:\s*([a-z]+)/im)?.[1]?.toLowerCase();
  const status = body.match(/^\s*Status:\s*([245])\.(\d{1,3})\.(\d{1,3})/im);
  if (action === "delayed" || /\bdelay(ed)?\b|will (be )?retr(y|ied)|still trying|not yet been delivered/i.test(subject)) return "delay";
  if (status) {
    if (status[1] === "4") return "soft";
    if (status[1] === "5" && status[2] === "2" && status[3] === "2") return "soft"; // mailbox full
    if (status[1] === "5") return "hard";
  }
  if (action === "failed") return "hard";
  if (/mailbox (is )?full|over quota|quota exceeded|temporar(y|ily)/i.test(body.slice(0, 1500))) return "soft";
  return "hard";
}
