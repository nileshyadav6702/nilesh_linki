/**
 * How a signal reads in the lead drawer: "Just engaged with a [competitor]" + "Competitor: lemlist".
 * The linked phrase points at the post or page behind the signal.
 */

export interface SignalInput { type: string; title: string; snippet: string | null; source_url: string | null; metadata_json?: string | null }
export interface SignalLine { lead: string; link: string | null; href: string | null; tail: string; sub: string | null }

function meta(s: SignalInput): Record<string, unknown> {
  try { return s.metadata_json ? JSON.parse(s.metadata_json) as Record<string, unknown> : {}; } catch { return {}; }
}

export function signalLine(s: SignalInput): SignalLine {
  const m = meta(s);
  const href = s.source_url || null;
  const commented = m.engagement === "comment" || /^Commented/i.test(s.title);
  const verb = commented ? "Commented on" : "Just engaged with";
  const engaged = (link: string, sub: string | null, article = "a"): SignalLine => ({ lead: `${verb} ${article} `, link, href, tail: "", sub });

  switch (s.type) {
    case "competitor_engagement": {
      const who = s.title.match(/(?:to|on) (.+?)['’]s post/i)?.[1] ?? null;
      return engaged("competitor", who ? `Competitor: ${who}` : null);
    }
    case "keyword_engagement": {
      const kw = s.title.match(/about ["“](.+?)["”]/i)?.[1] ?? null;
      return engaged("LinkedIn post", kw ? `Keyword: "${kw}"` : null);
    }
    case "influencer_engagement": {
      const who = s.title.match(/(?:to|on) (.+?)['’]s post/i)?.[1] ?? null;
      return engaged("expert's post", who ? `Expert: ${who}` : null, "an");
    }
    case "own_content_engagement":
      return engaged("your post", null, "");
    case "hiring": {
      const roles = Array.isArray(m.roles) ? m.roles as Array<{ title?: string }> : [];
      const n = roles.length;
      if (!n) return { lead: s.title, link: null, href: null, tail: "", sub: null };
      return { lead: "Hiring for ", link: `${n} role${n === 1 ? "" : "s"}`, href, tail: "", sub: roles.slice(0, 3).map((r) => r.title).filter(Boolean).join(" · ") || null };
    }
    case "job_change": {
      const from = typeof m.from_company === "string" && m.from_company ? `Previously at ${m.from_company}` : null;
      return { lead: s.title, link: null, href: null, tail: "", sub: from };
    }
    default:
      return { lead: s.title, link: null, href: null, tail: "", sub: s.snippet ? s.snippet.replace(/\s+/g, " ").slice(0, 140) : null };
  }
}
