export interface OutreachTemplateTarget {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  company?: string | null;
  title?: string | null;
  location?: string | null;
}

/** Reserved variable names resolved from the target row itself. Custom fields
 *  cannot shadow these. */
export const STANDARD_VARIABLE_KEYS = [
  "first_name", "last_name", "full_name", "company", "title", "location",
] as const;

/** Variables filled in at send time rather than from the contact (see lib/email/unsubscribe.ts). */
export const SEND_TIME_VARIABLE_KEYS = ["unsubscribe_url"] as const;

// {{key}} or {{key|fallback}}. The fallback is used when the value is empty or unknown.
const TOKEN = /\{\{\s*([a-z][a-z0-9_]*)\s*(?:\|([^{}]*))?\}\}/gi;
// Marks where a variable rendered empty, so the punctuation clean-up below only ever
// touches text next to a substitution and never rewrites the author's own copy.
const EMPTY = "\u0000";

function standardValue(key: string, target: OutreachTemplateTarget): string {
  const parts = (target.full_name ?? "").trim().split(/\s+/).filter(Boolean);
  switch (key) {
    case "first_name": return target.first_name?.trim() || parts[0] || "";
    case "last_name": return target.last_name?.trim() || parts.slice(1).join(" ");
    case "full_name": return target.full_name?.trim() ?? "";
    case "company": return target.company?.trim() ?? "";
    case "title": return target.title?.trim() ?? "";
    case "location": return target.location?.trim() ?? "";
    default: return "";
  }
}

/**
 * Resolves the contact variables used by live LinkedIn and email sends.
 *
 * Standard `{{first_name}}`-style tokens come from the target row. `custom` is
 * an optional map of workspace-defined custom-field keys → resolved string
 * values (see lib/outreach/custom-values.ts). `{{key|fallback}}` renders the
 * fallback when the value is empty. Unknown tokens without a fallback, and
 * send-time tokens such as {{unsubscribe_url}}, are left intact — callers that
 * send must check findUnresolvedTokens() before sending.
 *
 * An empty value never leaves "Hi ," behind: whitespace between an empty
 * substitution and the punctuation after it is removed, as is the double space
 * an empty variable leaves mid-sentence.
 */
export function renderOutreachTemplate(
  body: string,
  target: OutreachTemplateTarget,
  custom?: Record<string, string | null | undefined> | null,
): string {
  const customByKey = new Map<string, string | null | undefined>();
  for (const [key, value] of Object.entries(custom ?? {})) {
    // Only safe snake_case keys; never let a custom key override a standard one.
    if (!/^[a-z][a-z0-9_]*$/i.test(key)) continue;
    if ((STANDARD_VARIABLE_KEYS as readonly string[]).includes(key.toLowerCase())) continue;
    customByKey.set(key.toLowerCase(), value);
  }

  const out = body.replace(TOKEN, (whole, rawKey: string, fallback: string | undefined) => {
    const key = rawKey.toLowerCase();
    if ((SEND_TIME_VARIABLE_KEYS as readonly string[]).includes(key)) return whole;
    let value: string | undefined;
    if ((STANDARD_VARIABLE_KEYS as readonly string[]).includes(key)) value = standardValue(key, target);
    else if (customByKey.has(key)) value = (customByKey.get(key) ?? "").trim();
    if (!value) {
      const alt = fallback?.trim();
      if (alt) return alt;
      if (value === undefined && fallback === undefined) return whole; // unknown → left for the send check
    }
    return value || EMPTY;
  });

  return out
    .replace(/[ \t]+\u0000(?=[,.!?;:])/g, "")
    .replace(/([ \t])\u0000[ \t]+/g, "$1")
    .replace(/\u0000/g, "")
    .trim();
}

/** `{{...}}` placeholders still present in rendered text, e.g. a misspelt variable. */
export function findUnresolvedTokens(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(/\{\{[^{}]*\}\}/g), (m) => m[0]))];
}
