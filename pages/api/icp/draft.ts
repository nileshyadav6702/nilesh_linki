import type { NextApiRequest, NextApiResponse } from "next";
import { draftIcpFromWebsite } from "@/lib/icp/store";
import { AiNotConfiguredError } from "@/lib/ai/client";
import { UnsafeUrlError } from "@/lib/icp/site";
import { isRateLimited } from "@/lib/rate-limit";
import { requireWorkspace } from "@/lib/workspace";

// POST /api/icp/draft { website_url } → an ICP drafted from the website. Not saved.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, "manager");
  if (!ctx) return;
  const url = typeof req.body?.website_url === "string" ? req.body.website_url.trim() : "";
  if (!url || url.length > 400) return res.status(400).json({ error: "website_url is required" });
  if (isRateLimited(req, `icp-draft:${ctx.workspaceId}`, 10, 60 * 60_000)) return res.status(429).json({ error: "Too many ICP drafts — try again later" });
  try {
    return res.json(await draftIcpFromWebsite(ctx.workspaceId, url));
  } catch (err) {
    if (err instanceof AiNotConfiguredError || err instanceof UnsafeUrlError) return res.status(400).json({ error: err.message });
    const message = err instanceof Error ? err.message : "ICP draft failed";
    return res.status(502).json({ error: message });
  }
}

export const config = { api: { responseLimit: "2mb" }, maxDuration: 120 };
