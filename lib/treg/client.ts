import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";

/**
 * treg.to: one key (TREG_API_KEY) for ~100 data vendors, paid per call. Lead discovery and
 * profile enrichment go through it instead of the user's LinkedIn session, so they are not
 * held to LinkedIn's per-account read limits and never put the sending account at risk.
 *
 * Every call: X-Treg-Token auth, a hard cost ceiling (X-Treg-Route-Max-Cost), an idempotency
 * key, the workspace tagged for usage reports, the actual cost (X-Treg-Cost-Micro) logged in
 * treg_calls, and a per-workspace daily cap (TREG_DAILY_CAP_USD, default $5). Failed calls
 * are never billed by treg.
 */

const BASE = "https://treg.to";
const TIMEOUT_MS = 60_000;

export const tregEnabled = () => !!process.env.TREG_API_KEY?.trim();
export const dailyCapUsd = () => Math.max(0, Number(process.env.TREG_DAILY_CAP_USD ?? 5) || 0);

export class TregError extends Error {
  constructor(message: string, public status: number | null, public code: "balance" | "rate_limited" | "unavailable" | "cap" | "invalid" | "auth" | "network" | "upstream") {
    super(message);
    this.name = "TregError";
  }
  /** Worth trying again later (vs a request that will keep failing). */
  get retryable() { return this.code === "rate_limited" || this.code === "unavailable" || this.code === "network" || this.code === "upstream"; }
  /** Stop all treg work for now (no balance, bad key, cap reached). */
  get blocking() { return this.code === "balance" || this.code === "auth" || this.code === "cap"; }
}

export function spentTodayMicro(workspaceId: string | null): number {
  return (getDb().prepare("SELECT COALESCE(SUM(cost_micro), 0) s FROM treg_calls WHERE workspace_id IS ? AND created_at >= date('now')").get(workspaceId) as { s: number }).s;
}

export interface TregCallOpts {
  workspaceId: string | null;
  /** Short label for reporting (profile_enrich, engagement, people_search…). */
  purpose: string;
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Most this one call may cost, in USD. */
  maxCostUsd?: number;
  /** Routed endpoints: stop at the first provider miss instead of trying every child. */
  noWaterfall?: boolean;
  idempotencyKey?: string;
  /** Extra X-Treg-* options (e.g. X-Treg-Route-Verify). */
  headers?: Record<string, string>;
}

export interface TregResult<T> { data: T; costMicro: number; servedBy: string | null; callId: string | null }

function record(workspaceId: string | null, endpoint: string, purpose: string, status: number | null, costMicro: number, servedBy: string | null, error: string | null) {
  try {
    getDb().prepare("INSERT INTO treg_calls (id, workspace_id, endpoint, purpose, status, cost_micro, served_by, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), workspaceId, endpoint, purpose, status, costMicro, servedBy, error?.slice(0, 300) ?? null);
  } catch { /* reporting must never break a call */ }
}

export async function tregCall<T = unknown>(endpoint: string, opts: TregCallOpts): Promise<TregResult<T>> {
  const token = process.env.TREG_API_KEY?.trim();
  if (!token) throw new TregError("Treg isn't configured (TREG_API_KEY)", null, "auth");
  const cap = dailyCapUsd();
  if (cap > 0 && spentTodayMicro(opts.workspaceId) >= cap * 1_000_000) throw new TregError(`Daily data budget of $${cap} reached`, null, "cap");

  const url = new URL(`${BASE}/call/${endpoint}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = {
    "X-Treg-Token": token, Accept: "application/json",
    "X-Treg-Route-Max-Cost": String(opts.maxCostUsd ?? 0.05),
    "Idempotency-Key": opts.idempotencyKey ?? randomUUID(),
  };
  if (opts.workspaceId) headers["X-Treg-Meta"] = `workspace=${opts.workspaceId},purpose=${opts.purpose}`;
  if (opts.noWaterfall) headers["X-Treg-Route-Waterfall"] = "0";
  if (method === "POST") headers["Content-Type"] = "application/json";
  Object.assign(headers, opts.headers ?? {});

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    record(opts.workspaceId, endpoint, opts.purpose, null, 0, null, String(err));
    throw new TregError(`Treg unreachable: ${err instanceof Error ? err.message : String(err)}`, null, "network");
  }
  const cost = Number(res.headers.get("X-Treg-Cost-Micro") ?? 0) || 0;
  const servedBy = res.headers.get("X-Treg-Served-By");
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const detail = typeof data === "object" && data ? JSON.stringify(data).slice(0, 240) : String(text).slice(0, 240);
    record(opts.workspaceId, endpoint, opts.purpose, res.status, cost, servedBy, detail);
    if (res.status === 402) throw new TregError("Treg balance is empty. Top up at treg.to to resume lead discovery.", 402, "balance");
    if (res.status === 401 || res.status === 403) throw new TregError("Treg rejected the API key (TREG_API_KEY)", res.status, "auth");
    if (res.status === 429) throw new TregError("The data provider is rate limiting; retrying later", 429, "rate_limited");
    if (res.status === 503) throw new TregError(`No data provider available right now (${detail})`, 503, "unavailable");
    if (res.status === 400 || res.status === 404 || res.status === 422) throw new TregError(`Treg refused the request (${res.status}): ${detail}`, res.status, "invalid");
    throw new TregError(`Treg/provider error ${res.status}: ${detail}`, res.status, "upstream");
  }
  record(opts.workspaceId, endpoint, opts.purpose, res.status, cost, servedBy, null);
  return { data: data as T, costMicro: cost, servedBy, callId: res.headers.get("X-Treg-Call-Id") };
}
