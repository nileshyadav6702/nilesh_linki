import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { acceptJoinLink, lookupJoinLink } from "@/lib/workspace-join-links";

// GET  /api/join/:token → which workspace the link joins, and whether it still works
// POST /api/join/:token → join it as the signed-in user
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = String(req.query.token ?? "");
  const db = getDb();
  const link = token && token.length < 200 ? lookupJoinLink(db, token) : null;
  if (!link) return res.status(404).json({ error: "Invite link not found" });
  if (req.method === "GET") return res.json({ workspace_name: link.workspace_name, role: link.role, valid: link.valid, reason: link.reason });
  if (req.method === "POST") {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.id) return res.status(401).json({ error: "Sign in first", sign_in_required: true });
    try {
      const joined = acceptJoinLink(db, token, session.user.id);
      return res.json({ ok: true, workspace_id: joined.workspace_id, workspace_name: joined.workspace_name });
    } catch (err) { return res.status(400).json({ error: err instanceof Error ? err.message : "Could not join" }); }
  }
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end();
}
