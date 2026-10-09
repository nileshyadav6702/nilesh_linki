import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { isAiBlockingError } from "@/lib/ai/client";
import { fetchLookalikeProfile, LookalikeError, searchLookalikes, suggestSimilarTitles } from "@/lib/agents/lookalike-search";
import { SIZE_PRESETS } from "@/lib/icp/targeting";
import { requireWorkspace } from "@/lib/workspace";

// POST /api/agents/lookalike { action: "profile", url }            → the seed person's profile
// POST /api/agents/lookalike { action: "search", scope, seed_name } → { leads: top 5 by match, search_url }
// POST /api/agents/lookalike { action: "suggest", title, company }  → { titles: similar roles }
// Optional account_id on each picks the LinkedIn seat; default is the first connected one.

const id = z.string().regex(/^\d{1,20}$/).nullable();
const text = (max: number) => z.string().trim().max(max);
const scopeSchema = z.object({
  title: text(120).min(1, "Add the role to look for"),
  similarTitles: z.array(text(80).min(2)).max(10).default([]),
  includeSimilarRoles: z.boolean().default(true),
  location: text(160).nullable().default(null),
  geoId: id.default(null),
  industry: text(160).nullable().default(null),
  industryId: id.default(null),
  relatedIndustries: z.boolean().default(false),
  sizes: z.array(z.enum(SIZE_PRESETS.map((p) => p.value) as [string, ...string[]])).max(8).default([]),
});
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("profile"), url: text(400).min(1, "Paste a LinkedIn profile URL"), account_id: z.string().max(100).nullish() }),
  z.object({ action: z.literal("search"), scope: scopeSchema, seed_name: text(200).nullish(), account_id: z.string().max(100).nullish() }),
  z.object({ action: z.literal("suggest"), title: text(120).min(2), company: text(200).nullish() }),
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = requireWorkspace(req, res, "manager");
  if (!ctx) return;
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
  const b = parsed.data;
  try {
    if (b.action === "profile") return res.json({ profile: await fetchLookalikeProfile(ctx.workspaceId, b.url, b.account_id) });
    if (b.action === "search") {
      const r = await searchLookalikes(ctx.workspaceId, b.scope, b.seed_name ?? null, b.account_id);
      return res.json({ leads: r.leads, search_url: r.searchUrl });
    }
    return res.json({ titles: await suggestSimilarTitles(ctx.workspaceId, b.title, b.company ?? null) });
  } catch (err) {
    if (err instanceof LookalikeError) return res.status(err.status).json({ error: err.message });
    if (isAiBlockingError(err)) return res.status(400).json({ error: err.message });
    console.error("[api/agents/lookalike]", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}

export const config = { maxDuration: 300 };
