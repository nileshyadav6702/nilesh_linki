import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { addEntries, counts, entriesCsv, listEntries, MAX_ENTRIES_PER_REQUEST, removeEntries, type BlockKind } from "@/lib/blocklist/store";
import { firstIssue } from "@/lib/validation";
import { recordAudit, requireWorkspace } from "@/lib/workspace";

const PAGE_SIZE = 20;
const kind = z.enum(["company", "person"]);
const postSchema = z.object({
  kind,
  entries: z.array(z.object({ value: z.string().max(1000), label: z.string().max(300).nullish() })).min(1, "Add at least one entry").max(MAX_ENTRIES_PER_REQUEST, `Add at most ${MAX_ENTRIES_PER_REQUEST} entries at once`),
  source: z.enum(["manual", "csv"]).default("manual"),
});
const deleteSchema = z.object({ kind, ids: z.array(z.string().max(100)).min(1).max(MAX_ENTRIES_PER_REQUEST) });

// GET    /api/settings/blocklist?kind=company|person&q=&page=  → one page + counts per kind
// GET    /api/settings/blocklist?kind=…&format=csv             → the whole list as CSV
// POST   /api/settings/blocklist { kind, entries: [{ value, label? }], source? } → { added, existing, invalid }
// DELETE /api/settings/blocklist { kind, ids }
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST", "DELETE"].includes(req.method ?? "")) { res.setHeader("Allow", ["GET", "POST", "DELETE"]); return res.status(405).end(); }
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "member");
  if (!ctx) return;
  const db = getDb();

  if (req.method === "GET") {
    const k = kind.safeParse(req.query.kind ?? "company");
    if (!k.success) return res.status(400).json({ error: "kind must be company or person" });
    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="blocklist-${k.data === "company" ? "companies" : "people"}.csv"`);
      return res.send(entriesCsv(db, ctx.workspaceId, k.data as BlockKind));
    }
    const page = Math.max(1, Math.min(100_000, Number.parseInt(String(req.query.page ?? "1"), 10) || 1));
    const q = String(req.query.q ?? "").slice(0, 200);
    return res.json({ ...listEntries(db, ctx.workspaceId, k.data, q, page, PAGE_SIZE), page, page_size: PAGE_SIZE, counts: counts(db, ctx.workspaceId) });
  }
  if (req.method === "POST") {
    const parsed = postSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error, "Invalid entries") });
    const r = addEntries(db, ctx.workspaceId, parsed.data.kind, parsed.data.entries, ctx.userId, parsed.data.source);
    if (!r.added && !r.existing) return res.status(400).json({ error: parsed.data.kind === "company" ? "Enter valid website domains, like acme.com" : "Enter LinkedIn profile URLs, like https://www.linkedin.com/in/jane-doe", ...r });
    recordAudit(ctx, "blocklist.added", "workspace", ctx.workspaceId, { kind: parsed.data.kind, added: r.added });
    return res.json(r);
  }
  const parsed = deleteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error, "Choose entries to delete") });
  const removed = removeEntries(db, ctx.workspaceId, parsed.data.kind, parsed.data.ids);
  recordAudit(ctx, "blocklist.removed", "workspace", ctx.workspaceId, { kind: parsed.data.kind, removed });
  return res.json({ removed });
}
