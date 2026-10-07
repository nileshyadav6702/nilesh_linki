import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { recordVisit, workspaceForToken } from "@/lib/signals/website-visits";
import { isRateLimited } from "@/lib/rate-limit";
import { trackingRequestContext } from "@/lib/email/tracking-request";

// Public website-visitor pixel (under /api/t/, which the proxy leaves unauthenticated).
// Always answers with a 1x1 GIF so the host page never breaks, whatever happens.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const send = () => res.status(200).send(GIF);
  if (req.method !== "GET") return send();
  const token = String(req.query.token ?? "");
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token) || isRateLimited(req, `pixel:${token}`, 60, 60_000)) return send();
  const db = getDb();
  const workspaceId = workspaceForToken(db, token);
  if (!workspaceId) return send();
  const ip = trackingRequestContext(req).clientIp ?? "";
  const pageUrl = typeof req.query.u === "string" ? req.query.u.slice(0, 500) : null;
  const referrer = typeof req.query.r === "string" ? req.query.r.slice(0, 500) : null;
  try { await recordVisit(db, workspaceId, { ip, pageUrl, referrer }); } catch { /* never fail the pixel */ }
  return send();
}
