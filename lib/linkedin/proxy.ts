import { connect } from "net";
import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";

/**
 * Per-account proxy override for the LinkedIn browser. The same proxy must be used when the
 * session is created (login) and every time it is used, so LinkedIn sees one stable IP.
 */

const PROXY = /^(https?|socks5):\/\/([a-z0-9.-]+|\[[0-9a-f:]+\]):(\d{1,5})\/?$/i;

/** "1.2.3.4:8080" or "http://host:8080" → "http://host:8080"; null when it isn't a proxy address. */
export function normalizeProxyUrl(input: string): string | null {
  const raw = input.trim();
  const withScheme = /^[a-z0-9]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  const m = withScheme.match(PROXY);
  if (!m) return null;
  const port = Number(m[3]);
  if (port < 1 || port > 65535) return null;
  return `${m[1].toLowerCase()}://${m[2]}:${port}`;
}

export interface PlaywrightProxy { server: string; username?: string; password?: string }

/** The account's proxy in Playwright's shape, or undefined when it has none. */
export function accountProxy(accountId: string): PlaywrightProxy | undefined {
  const row = getDb().prepare("SELECT proxy_url, proxy_username, proxy_password FROM accounts WHERE id = ?").get(accountId) as
    { proxy_url: string | null; proxy_username: string | null; proxy_password: string | null } | undefined;
  if (!row?.proxy_url) return undefined;
  const server = normalizeProxyUrl(row.proxy_url);
  if (!server) return undefined;
  return {
    server,
    ...(row.proxy_username ? { username: row.proxy_username } : {}),
    ...(row.proxy_password ? { password: decryptSecret(row.proxy_password) ?? undefined } : {}),
  };
}

/** Can this machine open a TCP connection to the proxy? (Reachability only — credentials are checked by LinkedIn traffic.) */
export function checkProxyReachable(proxyUrl: string, timeoutMs = 5000): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  const url = normalizeProxyUrl(proxyUrl);
  if (!url) return Promise.resolve({ ok: false, error: "Not a proxy address (expected host:port)" });
  const { hostname, port } = new URL(url.replace(/^socks5:/, "http:"));
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = connect({ host: hostname.replace(/^\[|\]$/g, ""), port: Number(port) });
    const done = (r: { ok: true; ms: number } | { ok: false; error: string }) => { socket.destroy(); resolve(r); };
    socket.setTimeout(timeoutMs, () => done({ ok: false, error: `No answer within ${timeoutMs / 1000}s` }));
    socket.once("connect", () => done({ ok: true, ms: Date.now() - started }));
    socket.once("error", (err) => done({ ok: false, error: err.message }));
  });
}
