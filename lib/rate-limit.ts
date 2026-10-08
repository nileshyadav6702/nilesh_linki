// Minimal shape both a real NextApiRequest and NextAuth's authorize() RequestInternal
// satisfy — socket is optional since RequestInternal doesn't expose one.
type IpSource = {
  headers?: { [key: string]: string | string[] | undefined };
  socket?: { remoteAddress?: string };
};

// In-memory sliding-window rate limiter, per IP. No Redis/external service (self-hosted,
// single process — see CLAUDE.md). Resets on server restart; acceptable for a single-user
// tool defending against brute force on login/signup, not a distributed-attack mitigation.
const hits = new Map<string, number[]>();

// Periodically drop stale keys so this doesn't grow unbounded over a long-running process.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastSweep = Date.now();

export function isRateLimited(req: IpSource, key: string, limit: number, windowMs: number): boolean {
  const ip = clientIp(req);
  const mapKey = `${key}:${ip}`;
  const now = Date.now();

  sweepIfDue(now, windowMs);

  const timestamps = (hits.get(mapKey) ?? []).filter(t => now - t < windowMs);
  if (timestamps.length >= limit) {
    hits.set(mapKey, timestamps);
    return true;
  }

  timestamps.push(now);
  hits.set(mapKey, timestamps);
  return false;
}

function sweepIfDue(now: number, windowMs: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [mapKey, timestamps] of hits) {
    const fresh = timestamps.filter(t => now - t < windowMs);
    if (fresh.length === 0) hits.delete(mapKey);
    else hits.set(mapKey, fresh);
  }
}

// X-Real-IP / X-Forwarded-For are client-controlled unless a reverse proxy we trust
// overwrites them, so they are only honoured when TRUST_PROXY=1 (see DEPLOYMENT.md).
// Otherwise an attacker rotates a fake header per request and is never throttled.
export function clientIp(req: IpSource, env: NodeJS.ProcessEnv = process.env): string {
  if (env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true") {
    // nginx `proxy_set_header X-Real-IP $remote_addr` replaces any client value.
    const xRealIp = req.headers?.["x-real-ip"];
    if (typeof xRealIp === "string" && xRealIp.trim()) return xRealIp.trim();

    // The right-most entry is the one appended by our own proxy; anything to its left
    // came from the client and may be forged.
    const xForwardedFor = req.headers?.["x-forwarded-for"];
    const forwarded = Array.isArray(xForwardedFor) ? xForwardedFor.join(",") : xForwardedFor;
    if (typeof forwarded === "string" && forwarded) {
      const last = forwarded.split(",").map(s => s.trim()).filter(Boolean).pop();
      if (last) return last;
    }
  }

  // NextAuth's authorize() receives a socket-less RequestInternal, so the NextAuth route
  // stamps the real peer address into this header first (always overwriting any client
  // value — see pages/api/auth/[...nextauth].ts). A request with a socket ignores it.
  if (req.socket?.remoteAddress) return req.socket.remoteAddress;
  const stamped = req.headers?.[REMOTE_ADDR_HEADER];
  return (typeof stamped === "string" && stamped) || "unknown";
}

export const REMOTE_ADDR_HEADER = "x-linki-remote-addr";
