/**
 * Treg go/no-go check. Calls each endpoint the lead pipeline uses once, with real inputs, and
 * prints what came back (parsed by our own parsers) and what it cost.
 *
 *   npx tsx --env-file=.env.local scripts/treg-smoke.ts [competitorCompanyUrl] [profileUrl] [keyword]
 *
 * Spends well under $0.10.
 */
import { tregPostEngagers, tregProfile, tregRecentPosts, tregSearchPosts } from "@/lib/treg/linkedin";
import { tregPeopleSearch } from "@/lib/treg/people";
import { parseEntityUrl } from "@/lib/linkedin/engagers";
import type { Icp } from "@/lib/icp/schema";

const company = process.argv[2] ?? "https://www.linkedin.com/company/hubspot/";
const profile = process.argv[3] ?? "https://www.linkedin.com/in/williamhgates/";
const keyword = process.argv[4] ?? "outbound sales";
const WS = null as unknown as string;

async function step<T>(name: string, fn: () => Promise<T>, show: (r: T) => unknown) {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`\n✔ ${name} (${Date.now() - t0} ms)`);
    console.log(JSON.stringify(show(r), null, 2).slice(0, 1500));
    return r;
  } catch (err) {
    console.log(`\n✘ ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function main() {
  if (!process.env.TREG_API_KEY) { console.error("Set TREG_API_KEY in .env.local first"); process.exit(1); }

  await step("profile (headline/about/current job)", () => tregProfile(WS, profile), (p) => p);
  const entity = parseEntityUrl(company)!;
  const posts = await step("company posts", () => tregRecentPosts(WS, entity, 3), (ps) => ps.map((p) => ({ urn: p.activityUrn, at: p.postedAt, text: p.text.slice(0, 80) })));
  if (posts?.[0]) await step("engagers of newest post", () => tregPostEngagers(WS, posts[0], { reactions: 20 }), (es) => ({ count: es.length, sample: es.slice(0, 3) }));
  await step(`post search "${keyword}"`, () => tregSearchPosts(WS, keyword, 3), (ps) => ps.map((p) => ({ urn: p.activityUrn, text: p.text.slice(0, 80) })));
  const icp = { personas: [{ name: "Sales leaders", titles: ["VP of Sales", "Head of Sales"], seniority: [], departments: [], pains: [] }], geographies: ["US"], industries: [], company_sizes: ["51-200"], exclusions: [] } as unknown as Icp;
  await step("ICP people search (5 rows)", () => tregPeopleSearch(WS, icp, 5), (r) => ({ total: r.total, token: !!r.token, sample: r.leads.slice(0, 3) }));

  const { getDb } = await import("@/lib/db");
  const rows = getDb().prepare("SELECT endpoint, status, cost_micro, served_by, error FROM treg_calls WHERE purpose != 'smoke' ORDER BY created_at DESC LIMIT 20").all() as Array<{ cost_micro: number }>;
  console.log("\nCalls & cost:");
  console.table(rows);
  console.log(`Total: $${(rows.reduce((s, r) => s + r.cost_micro, 0) / 1e6).toFixed(4)}`);
}

void main();
