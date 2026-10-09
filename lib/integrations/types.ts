/** What adapters receive and must implement. Adapters only talk HTTP; the worker owns retries. */

export interface Lead {
  id: string; first_name: string | null; last_name: string | null; full_name: string | null; email: string | null;
  title: string | null; headline: string | null; company: string | null; company_domain: string | null; linkedin_url: string | null;
  phone: string | null; location: string | null; lead_score: number | null; agent: string | null;
}

export interface Reply { id: string; channel: "linkedin" | "email"; message: string; subject: string | null; received_at: string; teammate: string | null }

/** Decrypted connection config: the dialog's fields, the picked campaign/list/group, and OAuth tokens. */
export type Config = Record<string, string | undefined>;

export interface Choice { value: string; label: string }

export interface Adapter {
  /** Cheap authenticated call. Returns a label for the connected account when the API gives one. */
  verify(cfg: Config): Promise<{ account?: string }>;
  /** Campaigns / lists / groups to push into (apps with `pick` in the catalog). */
  choices?(cfg: Config): Promise<Choice[]>;
  /** Create or update the lead. Returns the remote id when known. */
  pushContact(cfg: Config, lead: Lead, opts: { verify?: boolean }): Promise<string | null>;
  /** Log a reply on the lead's record; create the record first when `create` and it doesn't exist. */
  addReply?(cfg: Config, lead: Lead, reply: Reply, opts: { create: boolean }): Promise<string | null>;
}

/**
 * A failed call. `permanent` failures (bad key, missing campaign, invalid data) stop retrying;
 * everything else (rate limits, 5xx, network) is retried with backoff.
 */
export class IntegrationError extends Error {
  constructor(message: string, public permanent = false, public status: number | null = null) {
    super(message);
    this.name = "IntegrationError";
  }
}

const TIMEOUT_MS = 20_000;

/** fetch + JSON with the error mapping every adapter needs. */
export async function call<T = unknown>(app: string, url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { Accept: "application/json", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new IntegrationError(`${app}: could not reach the API (${err instanceof Error ? err.message : String(err)})`);
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const detail = typeof body === "object" && body ? JSON.stringify(body).slice(0, 300) : String(text).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new IntegrationError(`${app} rejected the credentials (${res.status}). Check the key and its permissions.`, true, res.status);
    if (res.status === 429 || res.status >= 500) throw new IntegrationError(`${app} is unavailable right now (${res.status})`, false, res.status);
    throw new IntegrationError(`${app} refused the request (${res.status}): ${detail}`, true, res.status);
  }
  return body as T;
}

export const splitName = (l: Lead) => {
  const parts = (l.full_name ?? "").trim().split(/\s+/);
  return { first: l.first_name || parts[0] || "", last: l.last_name || parts.slice(1).join(" ") || "" };
};

export function replyNote(lead: Lead, r: Reply): string {
  const who = r.teammate ? ` to ${r.teammate}` : "";
  return `${r.channel === "linkedin" ? "LinkedIn" : "Email"} reply from ${lead.full_name ?? lead.email ?? "lead"}${who} on ${r.received_at.slice(0, 16).replace("T", " ")} UTC${r.subject ? `\nSubject: ${r.subject}` : ""}\n\n${r.message}`;
}

/** ISO time for a stored timestamp ("2026-10-09 10:00:00" UTC or already ISO). */
export function isoOf(s: string): string {
  const d = new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
