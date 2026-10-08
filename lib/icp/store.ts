import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { aiJson } from "@/lib/ai/client";
import { fetchSiteText } from "@/lib/icp/site";
import { ICP_OUTPUT_SHAPE, icpSchema, type Icp } from "@/lib/icp/schema";

export interface IcpRecord { id: string; workspace_id: string; version: number; website_url: string | null; data: Icp; created_at: string }

interface IcpRow { id: string; workspace_id: string; version: number; website_url: string | null; data_json: string; created_at: string }

function toRecord(row: IcpRow): IcpRecord {
  return { id: row.id, workspace_id: row.workspace_id, version: row.version, website_url: row.website_url, data: icpSchema.parse(JSON.parse(row.data_json)), created_at: row.created_at };
}

export function getIcp(id: string, workspaceId: string): IcpRecord | null {
  const row = getDb().prepare("SELECT * FROM icps WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as IcpRow | undefined;
  return row ? toRecord(row) : null;
}

export function getLatestIcp(workspaceId: string): IcpRecord | null {
  const row = getDb().prepare("SELECT * FROM icps WHERE workspace_id = ? ORDER BY version DESC LIMIT 1").get(workspaceId) as IcpRow | undefined;
  return row ? toRecord(row) : null;
}

export function listIcpVersions(workspaceId: string): Array<Omit<IcpRecord, "data">> {
  return getDb().prepare("SELECT id, workspace_id, version, website_url, created_at FROM icps WHERE workspace_id = ? ORDER BY version DESC").all(workspaceId) as Array<Omit<IcpRecord, "data">>;
}

/** Saves a new ICP version. Versions are immutable so past agent decisions stay explainable. */
export function saveIcp(workspaceId: string, data: unknown, websiteUrl: string | null, userId: string | null): IcpRecord {
  const parsed = icpSchema.parse(data);
  const db = getDb();
  const id = randomUUID();
  db.transaction(() => {
    const next = ((db.prepare("SELECT MAX(version) v FROM icps WHERE workspace_id = ?").get(workspaceId) as { v: number | null }).v ?? 0) + 1;
    db.prepare("INSERT INTO icps (id, workspace_id, version, website_url, data_json, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, workspaceId, next, websiteUrl, JSON.stringify(parsed), userId);
  })();
  return getIcp(id, workspaceId)!;
}

/** Reads the website and drafts an ICP. Not saved: the user reviews and edits it first. */
export async function draftIcpFromWebsite(workspaceId: string, websiteUrl: string): Promise<{ icp: Icp; website_url: string; pages: string[] }> {
  const site = await fetchSiteText(websiteUrl);
  const icp = await aiJson({
    workspaceId,
    purpose: "icp_extract",
    temperature: 0.2,
    instructions: [
      "Read the company's website pages under data.pages and work out who this company is and who it sells to.",
      "company_industry is the seller's own industry. industries are the industries of the buyers.",
      "offer is the company description and value proposition in 2-4 sentences. value_props are distinct product features. social_proof are customers, metrics, or awards stated on the site; leave it empty if the site states none. language is the language the site is written in.",
      "company_types use only these labels: Private Company, Public Company, Startup, Non-profit, Government, Educational Institution. company_sizes use only: 1-10 employees, 11-50 employees, 51-200 employees, 201-500 employees, 501-1000 employees, 1001-5000 employees, 5001-10000 employees, 10000+ employees. geographies are buyer locations. language is English (US) when the site is in English.",
      "pain_points are the customer problems the product addresses.",
      "Define 2-4 buyer personas with realistic LinkedIn job titles (as people write them on LinkedIn), seniority and departments.",
      "List direct competitors you can infer from the site or that are well known in this exact category; include their LinkedIn company page URL only if you are confident of it, else null.",
      "keywords: 8-20 short phrases buyers would post or comment about on LinkedIn (topics, not the company's own brand).",
      "exclusions: job titles or profile words to ignore (e.g. students, recruiters, the company's own employees, competitors' employees).",
      "sales_nav_keywords: a Sales Navigator boolean keyword query that finds the main persona, e.g. (\"VP Sales\" OR \"Head of Sales\") AND SaaS.",
      "Use only what the pages support plus well-established market knowledge; leave a list empty rather than guess.",
    ],
    data: { website: site.url, pages: site.pages },
    outputShape: ICP_OUTPUT_SHAPE,
    schema: icpSchema,
  });
  return { icp, website_url: site.url, pages: site.pages.map((p) => p.url) };
}
