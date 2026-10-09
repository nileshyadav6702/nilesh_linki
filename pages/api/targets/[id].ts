import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireWorkspace, recordAudit } from "@/lib/workspace";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const id = req.query.id as string;
  const ctx = requireWorkspace(req, res, req.method === "GET" ? "viewer" : "member");
  if (!ctx) return;

  if (req.method === "GET") {
    const target = db.prepare("SELECT * FROM targets WHERE id = ? AND workspace_id = ?").get(id, ctx.workspaceId);
    if (!target) return res.status(404).json({ error: "Not found" });

    const company = db.prepare("SELECT * FROM companies WHERE id = (SELECT company_id FROM targets WHERE id = ?)").get(id);
    const lists = db.prepare(`
      SELECT l.id, l.name FROM lists l
      INNER JOIN list_targets lt ON lt.list_id = l.id
      WHERE lt.target_id = ?
      ORDER BY l.name COLLATE NOCASE
    `).all(id);

    return res.json({ ...target as object, company: company ?? null, lists });
  }

  if (req.method === "PATCH") {
    const target = db.prepare("SELECT id FROM targets WHERE id = ? AND workspace_id = ?").get(id, ctx.workspaceId);
    if (!target) return res.status(404).json({ error: "Not found" });

    // Editable contact fields (CRM hygiene). Anything else is owned by enrichment/automation.
    const EDITABLE = [
      "first_name", "last_name", "full_name", "title", "company", "location",
      "email", "phone", "headline", "summary", "notes",
    ] as const;

    const body = { ...(req.body as Record<string, unknown>) };
    for (const col of EDITABLE) {
      const v = body[col];
      if (v !== undefined && v !== null && (typeof v !== "string" || v.length > (col === "notes" || col === "summary" ? 20_000 : 500))) {
        return res.status(400).json({ error: `${col.replace("_", " ")} must be text` });
      }
    }
    if (typeof body.email === "string" && body.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
      return res.status(400).json({ error: "That doesn't look like an email address" });
    }
    if (typeof body.phone === "string" && body.phone.trim() && !/^[+()\d\s.-]{5,30}$/.test(body.phone.trim())) {
      return res.status(400).json({ error: "That doesn't look like a phone number" });
    }
    // Renaming via first / last name keeps full_name in step (lists, search and messages use it).
    if ((body.first_name !== undefined || body.last_name !== undefined) && body.full_name === undefined) {
      const cur = db.prepare("SELECT first_name, last_name FROM targets WHERE id = ?").get(id) as { first_name: string | null; last_name: string | null };
      const first = body.first_name !== undefined ? String(body.first_name ?? "").trim() : cur.first_name ?? "";
      const last = body.last_name !== undefined ? String(body.last_name ?? "").trim() : cur.last_name ?? "";
      if (!first && !last) return res.status(400).json({ error: "A contact needs a name" });
      body.full_name = [first, last].filter(Boolean).join(" ");
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const col of EDITABLE) {
      if (body[col] !== undefined) {
        const v = body[col];
        fields.push(`${col} = ?`);
        params.push(typeof v === "string" ? (v.trim() || null) : v);
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: "No editable fields provided" });
    params.push(id);
    db.prepare(`UPDATE targets SET ${fields.join(", ")} WHERE id = ? AND workspace_id = ?`).run(...params, ctx.workspaceId);

    recordAudit(ctx, "contact.updated", "contact", id, body);
    return res.json(db.prepare("SELECT * FROM targets WHERE id = ? AND workspace_id = ?").get(id, ctx.workspaceId));
  }

  if (req.method === "DELETE") {
    const target = db.prepare("SELECT id FROM targets WHERE id = ? AND workspace_id = ?").get(id, ctx.workspaceId);
    if (!target) return res.status(404).json({ error: "Not found" });
    // Some references (run_profiles, logs) have no ON DELETE CASCADE — clear them first so the
    // FK constraint doesn't block the delete. run_profile_tracks cascade off run_profiles.
    db.transaction(() => {
      db.prepare("DELETE FROM run_profiles WHERE target_id = ?").run(id);
      db.prepare("DELETE FROM logs WHERE target_id = ?").run(id);
      db.prepare("DELETE FROM targets WHERE id = ? AND workspace_id = ?").run(id, ctx.workspaceId);
    })();
    recordAudit(ctx, "contact.deleted", "contact", id);
    return res.json({ ok: true });
  }

  res.setHeader("Allow", ["GET", "PATCH", "DELETE"]);
  return res.status(405).end();
}
