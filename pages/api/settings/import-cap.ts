import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getDailyImportCap, setDailyImportCap, DEFAULT_DAILY_CAP } from "@/lib/import-jobs";
import { requireWorkspace } from "@/lib/workspace";

/**
 * GET → { cap }, PUT { cap } → set THIS workspace's daily import cap. It used to write one
 * instance-wide value, so any workspace admin changed every other tenant's quota.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx=requireWorkspace(req,res,req.method==="GET"?"viewer":"admin"); if(!ctx)return;
  const db = getDb();

  if (req.method === "GET") {
    return res.json({ cap: getDailyImportCap(db, ctx.workspaceId), default: DEFAULT_DAILY_CAP });
  }

  if (req.method === "PUT") {
    const { cap } = (req.body ?? {}) as { cap?: number };
    const n = Number(cap);
    if (!Number.isFinite(n) || n < 1 || n > 100_000) return res.status(400).json({ error: "cap must be a number between 1 and 100000" });
    setDailyImportCap(db, n, ctx.workspaceId);
    return res.json({ cap: getDailyImportCap(db, ctx.workspaceId) });
  }

  res.setHeader("Allow", ["GET", "PUT"]);
  return res.status(405).end();
}
