import type { NextApiRequest, NextApiResponse } from "next";
import { isRateLimited } from "@/lib/rate-limit";
import { unsubscribeAddress, verifyUnsubscribeToken } from "@/lib/email/unsubscribe";

// Public unsubscribe endpoint (under /api/u/, which the proxy leaves unauthenticated).
//   POST → RFC 8058 one-click unsubscribe (mail clients POST "List-Unsubscribe=One-Click"),
//          also the target of the confirmation form below.
//   GET  → a confirmation page with a button. GET never suppresses on its own: link scanners
//          and security gateways fetch every URL in a message, and would unsubscribe people.
// The token is an HMAC over (workspace, address) — see lib/email/unsubscribe.ts.

function page(res: NextApiResponse, status: number, title: string, body: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  return res.status(status).send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;background:#f6f7f9;color:#1a2029;margin:0;padding:48px 16px}main{max-width:440px;margin:0 auto;background:#fff;border:1px solid #e3e6ea;border-radius:8px;padding:28px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.5}button{background:#2450e6;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:15px;cursor:pointer}</style>
</head><body><main><h1>${title}</h1>${body}</main></body></html>`);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end();
  }
  const token = String(req.query.token ?? "");
  const verified = verifyUnsubscribeToken(token);
  // Only bad tokens are rate limited (guessing). A valid signed link can't be forged, and
  // one-click POSTs arrive from a few mail-provider IPs shared by everyone: limiting those
  // would drop real unsubscribes.
  if (!verified) {
    if (isRateLimited(req, "unsubscribe", 30, 60_000)) {
      res.setHeader("Retry-After", "60");
      return page(res, 429, "Too many requests", "<p>Please try again in a minute.</p>");
    }
    return page(res, 400, "Invalid link", "<p>This unsubscribe link is invalid or has been altered. To stop these emails, reply to one of them with the word \"unsubscribe\".</p>");
  }

  if (req.method === "GET") {
    return page(res, 200, "Unsubscribe", `<p>Stop receiving emails at <strong>${maskEmail(verified.email)}</strong>?</p>
<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Unsubscribe</button></form>`);
  }

  unsubscribeAddress(verified.workspaceId, verified.email);
  return page(res, 200, "You have been unsubscribed", `<p>${maskEmail(verified.email)} will not receive further emails from this sender.</p>`);
}
