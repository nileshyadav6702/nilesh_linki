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

export const icpSchema = z.object({
  company_name: str(160).default(""),
  offer: str(500).default(""),
  value_props: list(10, 300),
  pain_points: list(10, 300),
  industries: list(20, 120),
  company_sizes: list(10, 60),
  geographies: list(20, 120),
  personas: z.array(personaSchema).max(8).default([]),
  competitors: z.array(competitorSchema).max(15).default([]),
  keywords: list(30, 80),
  exclusions: list(30, 120),
  sales_nav_keywords: str(500).default(""),
});

export type Icp = z.infer<typeof icpSchema>;
export type Persona = z.infer<typeof personaSchema>;

export const ICP_OUTPUT_SHAPE = `{"company_name":"","offer":"one sentence","value_props":[""],"pain_points":[""],"industries":[""],"company_sizes":["11-50"],"geographies":[""],"personas":[{"name":"","titles":[""],"seniority":[""],"departments":[""],"pains":[""]}],"competitors":[{"name":"","linkedin_url":"https://www.linkedin.com/company/... or null","website":"or null"}],"keywords":[""],"exclusions":[""],"sales_nav_keywords":"boolean keyword query"}`;

/** All job titles the ICP targets, lower-cased, for cheap rule-based filtering. */
export function icpTitleTerms(icp: Icp): string[] {
  return [...new Set(icp.personas.flatMap((p) => p.titles).map((t) => t.toLowerCase()).filter(Boolean))];
}
