import type { Page } from "playwright";

type Degree = 1 | 2 | 3;
const DEGREE: Record<string, Degree> = { "1st": 1, "2nd": 2, "3rd": 3 };

/**
 * The connection degree in a profile card's text, from the degree badge only ("· 1st",
 * "1st degree connection", or a badge element whose whole text is "1st"). Matching any "1st"
 * in the card took a headline like "Partner at 1st Round Capital" for a connection: the
 * invitation was never sent and the lead moved on to messages LinkedIn wouldn't deliver.
 */
export function degreeFromText(text: string): Degree | null {
  const m = text.match(/\b(1st|2nd|3rd)\+?\s+degree connection\b/i)
    ?? text.match(/[·•]\s*(1st|2nd|3rd)\+?(?![\w-])/i)
    ?? text.match(/^\s*(1st|2nd|3rd)\+?\s*$/im);
  return m ? DEGREE[m[1].toLowerCase()] : null;
}

/** The profile card's degree: the badge's own elements first, then the card's visible text. */
export async function profileDegree(page: Page): Promise<Degree | null> {
  const badges = await page.locator('main .dist-value, main [class*="distance-badge"], main .pv-top-card span.visually-hidden')
    .evaluateAll((els) => els.slice(0, 40).map((e) => (e.textContent ?? "").trim()).filter(Boolean).join("\n")).catch(() => "");
  if (degreeFromText(badges)) return degreeFromText(badges);
  const card = await page.locator(".pv-top-card, .scaffold-layout__main").first().innerText().catch(() => "");
  // The card's own text holds the headline too: only the "· 1st" / "1st degree connection" forms count there.
  const m = card.match(/\b(1st|2nd|3rd)\+?\s+degree connection\b/i) ?? card.match(/[·•]\s*(1st|2nd|3rd)\+?(?![\w-])/i);
  return m ? DEGREE[m[1].toLowerCase()] : null;
}
