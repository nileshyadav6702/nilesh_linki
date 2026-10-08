import type { Icp } from "@/lib/icp/schema";

/**
 * Targeting helpers shared by the "Edit targeting" drawer and lead scoring: how presets map to
 * stored ICP values, and which ICP fields count as targeting (vs. company / offer fields).
 */

/** Onboarding stores this phrase in `exclusions`; it means the same as `exclude_service_providers`. */
export const SERVICE_PROVIDER_LABEL = "Service providers, freelancers, consultants";

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function excludesServiceProviders(icp: Pick<Icp, "exclude_service_providers" | "exclusions">): boolean {
  return !!icp.exclude_service_providers || icp.exclusions.some((x) => sameText(x, SERVICE_PROVIDER_LABEL));
}

/** Company names / keywords to exclude, without the service-provider marker phrase. */
export function exclusionTerms(icp: Pick<Icp, "exclusions">): string[] {
  return icp.exclusions.map((x) => x.trim()).filter((x) => x && !sameText(x, SERVICE_PROVIDER_LABEL));
}

/* ─── Company size ─────────────────────────────────────────────────────────────────────────── */

export interface Preset { value: string; label: string }

/** Stored values follow the AI draft / onboarding format ("11-50 employees"); labels use an en dash. */
export const SIZE_PRESETS: Preset[] = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10000+"]
  .map((r) => ({ value: `${r} employees`, label: `${r.replace("-", "–")} employees` }));

/** "11-50", "11–50 employees", "11 - 50" → "11-50", so older stored formats still match a preset. */
export function sizeKey(v: string): string {
  return v.toLowerCase().replace(/employees?/g, "").replace(/[–—]/g, "-").replace(/,/g, "").replace(/\s+/g, "");
}

export function sizePreset(v: string): Preset | undefined {
  const k = sizeKey(v);
  return SIZE_PRESETS.find((p) => sizeKey(p.value) === k);
}

export const sizeLabel = (v: string) => sizePreset(v)?.label ?? v;

/** Toggles a size preset, removing any stored alias of it ("11-50" and "11-50 employees"). */
export function toggleSize(sizes: string[], preset: Preset): string[] {
  const k = sizeKey(preset.value);
  const has = sizes.some((s) => sizeKey(s) === k);
  return has ? sizes.filter((s) => sizeKey(s) !== k) : [...sizes, preset.value];
}

/* ─── Company type ─────────────────────────────────────────────────────────────────────────── */

export const TYPE_PRESETS = ["Private Company", "Public Company", "Startup", "Non-profit", "Government", "Educational Institution", "Other"];

export function toggleType(types: string[], type: string): string[] {
  return types.some((t) => sameText(t, type)) ? types.filter((t) => !sameText(t, type)) : [...types, type];
}

/* ─── Job roles (flattened persona titles) ─────────────────────────────────────────────────── */

export function roleTitles(icp: Pick<Icp, "personas">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of icp.personas.flatMap((p) => p.titles)) {
    const k = t.trim().toLowerCase();
    if (k && !seen.has(k)) { seen.add(k); out.push(t.trim()); }
  }
  return out;
}

/** Adds a role to the first persona, creating a "Target roles" persona when there is none. */
export function addRole(icp: Icp, title: string): Icp {
  const t = title.trim();
  if (!t || roleTitles(icp).some((x) => sameText(x, t))) return icp;
  if (!icp.personas.length) return { ...icp, personas: [{ name: "Target roles", titles: [t], seniority: [], departments: [], pains: [] }] };
  return { ...icp, personas: icp.personas.map((p, i) => (i === 0 ? { ...p, titles: [...p.titles, t] } : p)) };
}

/** Removes a role from every persona. */
export function removeRole(icp: Icp, title: string): Icp {
  return { ...icp, personas: icp.personas.map((p) => ({ ...p, titles: p.titles.filter((x) => !sameText(x, title)) })) };
}

export function setRoles(icp: Icp, titles: string[]): Icp {
  let next = { ...icp, personas: icp.personas.map((p) => ({ ...p, titles: p.titles.filter((x) => titles.some((t) => sameText(t, x))) })) };
  for (const t of titles) next = addRole(next, t);
  return next;
}

/* ─── Bulk edits ───────────────────────────────────────────────────────────────────────────── */

/** Folds onboarding's service-provider phrase into the boolean so the drawer shows one control. */
export function normalizeTargeting(icp: Icp): Icp {
  return { ...icp, exclude_service_providers: excludesServiceProviders(icp), exclusions: exclusionTerms(icp) };
}

/** Empties every targeting field; company, offer, competitors and scoring mode are kept. */
export function clearTargeting(icp: Icp): Icp {
  return {
    ...icp,
    personas: icp.personas.map((p) => ({ ...p, titles: [] })),
    industries: [], company_types: [], company_sizes: [], geographies: [], exclusions: [], mandatory_keywords: [],
    exclude_service_providers: false,
  };
}

/** Takes the targeting fields from an AI draft and keeps everything else from the current ICP. */
export function applyDraftTargeting(icp: Icp, draft: Icp): Icp {
  const sizes = draft.company_sizes.map((s) => sizePreset(s)?.value ?? s);
  return normalizeTargeting({
    ...icp,
    personas: draft.personas,
    industries: draft.industries,
    company_types: draft.company_types,
    company_sizes: [...new Set(sizes)],
    geographies: draft.geographies,
    exclusions: draft.exclusions,
    exclude_service_providers: icp.exclude_service_providers || excludesServiceProviders(draft),
  });
}

/* ─── Text matching used by rule-based screening ───────────────────────────────────────────── */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive match of a keyword as a whole word / phrase ("AI" matches "AI-first", not "said"). */
export function hasTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(t)}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}
