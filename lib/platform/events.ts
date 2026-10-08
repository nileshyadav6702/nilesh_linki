import { createHmac, randomUUID } from "crypto";
import http from "http";
import https from "https";
import net from "net";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "dns";
import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { isPrivateAddress } from "@/lib/icp/site";

const WEBHOOK_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARS = 4000;

export class UnsafeWebhookUrlError extends Error {}

/**
 * True for any address a customer-supplied webhook must never reach: loopback, RFC1918,
 * link-local (incl. the 169.254.169.254 cloud metadata service), CGNAT, multicast,
 * unspecified, IPv6 ULA/link-local/site-local, and IPv4 embedded in IPv6 (mapped,
 * compatible, NAT64, 6to4) — the embedded form is unwrapped and checked as IPv4.
 */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "").split("%")[0];
  if (net.isIPv4(addr)) {
    const [a, b, c] = addr.split(".").map(Number);
    return isPrivateAddress(addr) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  if (!net.isIPv6(addr)) return true;
  const groups = expandIpv6(addr);
  if (!groups) return true;
  const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    if (groups[5] === 0 && groups[6] === 0 && groups[7] <= 1) return true; // :: and ::1
    return isBlockedAddress(embedded(groups[6], groups[7])); // IPv4-mapped / -compatible
  }
  if (groups[0] === 0x64 && groups[1] === 0xff9b) return isBlockedAddress(embedded(groups[6], groups[7])); // NAT64
  if (groups[0] === 0x2002) return isBlockedAddress(embedded(groups[1], groups[2])); // 6to4
  const first = groups[0];
  return (first & 0xfe00) === 0xfc00 // fc00::/7 unique local
    || (first & 0xffc0) === 0xfe80 // fe80::/10 link-local
    || (first & 0xffc0) === 0xfec0 // fec0::/10 site-local
    || (first & 0xff00) === 0xff00 // ff00::/8 multicast
    || (first === 0x2001 && groups[1] === 0x0db8); // documentation
}

function expandIpv6(addr: string): number[] | null {
  let text = addr.toLowerCase();
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4[1].split(".").map(Number);
    text = text.slice(0, -v4[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = text.includes("::") ? 8 - h.length - t.length : 0;
  const parts = [...h, ...Array<string>(Math.max(fill, 0)).fill("0"), ...t];
  if (parts.length !== 8) return null;
  return parts.map((p) => parseInt(p, 16));
}

/**
 * Validate a webhook URL before it is stored or called: http(s) only, no embedded
 * credentials, no obviously-internal hostnames, and a literal IP host must be public.
 * Hostnames are additionally checked at connect time by guardedLookup, so a name that
 * resolves (or re-resolves) to a private address is refused too.
 */
export function assertPublicWebhookUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new UnsafeWebhookUrlError("Invalid webhook URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new UnsafeWebhookUrlError("Webhook URL must use http(s)");
  if (url.username || url.password) throw new UnsafeWebhookUrlError("Webhook URL must not contain credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeWebhookUrlError("Webhook URL must point to a public host");
  }
  if (net.isIP(host) && isBlockedAddress(host)) throw new UnsafeWebhookUrlError("Webhook URL must point to a public address");
  return url;
}

/** assertPublicWebhookUrl plus a DNS check that every address the host resolves to is public. */
export async function assertPublicWebhookTarget(value: string): Promise<URL> {
  const url = assertPublicWebhookUrl(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return url;
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) =>
    dnsLookup(host, { all: true }, (err, list) => err ? reject(new UnsafeWebhookUrlError(`Could not resolve ${host}`)) : resolve(list)));
  if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
    throw new UnsafeWebhookUrlError("Webhook URL must point to a public address");
  }
  return url;
}

/** DNS lookup used for the actual connection: every resolved address must be public. */
export function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isBlockedAddress(a.address))) {
      return callback(new UnsafeWebhookUrlError(`Webhook host ${hostname} resolves to a non-public address`), "");
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

/**
 * POST without following redirects (a 3xx counts as a failed delivery) and with the
 * connection made to the exact address guardedLookup approved, so DNS rebinding between
 * the check and the connect cannot point the request inward.
 */
function postWebhook(url: URL, headers: Record<string, string>, body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, {
      method: "POST",
      headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
      lookup: guardedLookup as unknown as net.LookupFunction,
      timeout: WEBHOOK_TIMEOUT_MS,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => { if (size < MAX_RESPONSE_CHARS) { chunks.push(chunk); size += chunk.length; } });
      res.on("end", () => { clearTimeout(timer); resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8").slice(0, MAX_RESPONSE_CHARS) }); });
      res.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
    const timer = setTimeout(() => req.destroy(new Error("Webhook request timed out")), WEBHOOK_TIMEOUT_MS);
    req.on("timeout", () => req.destroy(new Error("Webhook request timed out")));
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    req.end(body);
  });
}

export const EVENT_TYPES = ["email.sent", "email.delivered", "email.bounced", "reply.received", "reply.classified", "linkedin.connected", "linkedin.message_sent", "meeting.booked", "workflow.completed", "contact.created", "signal.received", "lead.qualified", "draft.pending", "draft.approved"] as const;

export function emitDomainEvent(input: { workspaceId: string; type: string; entityType?: string; entityId?: string; payload?: unknown }) {
  const db = getDb();
  const eventId = randomUUID();
  const payload = JSON.stringify(input.payload ?? {});
  db.transaction(() => {
    db.prepare("INSERT INTO domain_events (id, workspace_id, type, entity_type, entity_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(eventId, input.workspaceId, input.type, input.entityType ?? null, input.entityId ?? null, payload);
    const endpoints = db.prepare("SELECT id, event_types FROM webhook_endpoints WHERE workspace_id = ? AND enabled = 1").all(input.workspaceId) as Array<{ id: string; event_types: string }>;
    const insert = db.prepare("INSERT OR IGNORE INTO webhook_deliveries (id, workspace_id, event_id, endpoint_id) VALUES (?, ?, ?, ?)");
    for (const endpoint of endpoints) {
      const types = endpoint.event_types === "*" ? null : endpoint.event_types.split(",").map((x) => x.trim());
      if (!types || types.includes(input.type)) insert.run(randomUUID(), input.workspaceId, eventId, endpoint.id);
    }
  })();
  return eventId;
}

export async function processWebhookDeliveries(limit = 20): Promise<number> {
  const db = getDb();
  const rows = db.prepare(`SELECT wd.id, wd.attempt, we.url, we.secret, de.id event_id, de.type,
      de.entity_type, de.entity_id, de.payload_json, de.occurred_at
    FROM webhook_deliveries wd
    JOIN webhook_endpoints we ON we.id = wd.endpoint_id
    JOIN domain_events de ON de.id = wd.event_id
    WHERE wd.status IN ('pending','retrying') AND wd.next_attempt_at <= datetime('now') AND we.enabled = 1
    ORDER BY wd.created_at LIMIT ?`).all(limit) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const body = JSON.stringify({ id: row.event_id, type: row.type, entity_type: row.entity_type, entity_id: row.entity_id, occurred_at: row.occurred_at, data: JSON.parse(String(row.payload_json)) });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secret = decryptSecret(String(row.secret)) ?? String(row.secret);
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    try {
      const target = assertPublicWebhookUrl(String(row.url));
      const response = await postWebhook(target, { "content-type": "application/json", "user-agent": "Linki-Webhooks/1.0", "x-linki-event": String(row.type), "x-linki-timestamp": timestamp, "x-linki-signature": `sha256=${signature}` }, body);
      const responseBody = response.text;
      if (response.status >= 200 && response.status < 300) {
        db.prepare("UPDATE webhook_deliveries SET status = 'delivered', attempt = attempt + 1, response_status = ?, response_body = ?, delivered_at = datetime('now') WHERE id = ?").run(response.status, responseBody, row.id);
      } else throw new Error(`HTTP ${response.status}: ${responseBody}`);
    } catch (error) {
      const attempt = Number(row.attempt) + 1;
      const dead = attempt >= 8;
      const delayMinutes = Math.min(2 ** attempt, 360);
      db.prepare(`UPDATE webhook_deliveries SET status = ?, attempt = ?, last_error = ?,
        next_attempt_at = datetime('now', ?) WHERE id = ?`)
        .run(dead ? "dead_letter" : "retrying", attempt, error instanceof Error ? error.message : String(error), `+${delayMinutes} minutes`, row.id);
    }
  }
  db.prepare(`UPDATE domain_events SET processed_at = datetime('now') WHERE processed_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM webhook_deliveries wd WHERE wd.event_id = domain_events.id AND wd.status IN ('pending','retrying'))`).run();
  return rows.length;
}
