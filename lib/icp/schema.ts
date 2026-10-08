import { z } from "zod";

const str = (max = 300) => z.string().trim().max(max);
const list = (max = 30, len = 200) => z.array(str(len)).max(max).default([]);

export const personaSchema = z.object({
  name: str(120),
  titles: list(20, 120),
  seniority: list(10, 60),
  departments: list(10, 80),
  pains: list(10, 300),
});

export const competitorSchema = z.object({
  name: str(120),
  linkedin_url: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  website: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
});

export const MATCH_MODES = ["high_precision", "broader", "skip"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const icpSchema = z.object({
  company_name: str(160).default(""),
  company_industry: str(120).default(""),
  offer: str(1200).default(""),
  value_props: list(12, 300),
  social_proof: list(12, 400),
  language: str(60).default("English"),
  pain_points: list(10, 300),
  industries: list(20, 120),
  company_sizes: list(10, 60),
  company_types: list(12, 80),
  geographies: list(20, 120),
  personas: z.array(personaSchema).max(8).default([]),
  competitors: z.array(competitorSchema).max(15).default([]),
  keywords: list(30, 80),
  exclusions: list(30, 120),
  sales_nav_keywords: str(500).default(""),
  /** Drop agencies, consultants, freelancers and B2B service companies before scoring. */
  exclude_service_providers: z.boolean().default(false),
  /** Ask the scorer to also drop people at competitors the user has not listed. */
  ai_competitor_filtering: z.boolean().default(false),
  /** How strictly leads must match: high_precision (default), broader, or skip scoring entirely. */
  match_mode: z.enum(MATCH_MODES).default("high_precision"),
  /** A lead must mention at least one of these (headline, title, about or company) to qualify. */
  mandatory_keywords: list(30, 80),
});

export type Icp = z.infer<typeof icpSchema>;
export type Persona = z.infer<typeof personaSchema>;

export const ICP_OUTPUT_SHAPE = `{"company_name":"","company_industry":"","offer":"what the company does and the value it promises, 2-4 sentences","value_props":["key product feature"],"social_proof":["a customer, metric, or award from the site"],"language":"English","pain_points":[""],"industries":["buyer industry"],"company_sizes":["11-50"],"company_types":["SMB"],"geographies":[""],"personas":[{"name":"","titles":[""],"seniority":[""],"departments":[""],"pains":[""]}],"competitors":[{"name":"","linkedin_url":"https://www.linkedin.com/company/... or null","website":"or null"}],"keywords":[""],"exclusions":[""],"sales_nav_keywords":"boolean keyword query"}`;

/** All job titles the ICP targets, lower-cased, for cheap rule-based filtering. */
export function icpTitleTerms(icp: Icp): string[] {
  return [...new Set(icp.personas.flatMap((p) => p.titles).map((t) => t.toLowerCase()).filter(Boolean))];
}
