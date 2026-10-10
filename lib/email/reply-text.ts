/**
 * The part of an email reply the person actually wrote: everything above the quoted original
 * (and without our own footer). Reply classification and opt-out detection read only this, so a
 * reply that quotes our "Unsubscribe: <link>" footer is not mistaken for an unsubscribe request.
 */

/** Lines where a quoted original starts (Gmail, Apple Mail, Outlook, and common languages). */
const QUOTE_HEADERS: RegExp[] = [
  /^on\b.{0,200}\bwrote:\s*$/i,
  /^on\b.{0,200}$/i, // "On Mon, 6 Oct 2026 at 10:00, Jane <jane@x.io>" wrapped before "wrote:"
  /^-{2,}\s*original message\s*-{2,}/i,
  /^-{2,}\s*forwarded message\s*-{2,}/i,
  /^_{8,}\s*$/,
  /^le\b.{0,200}\ba écrit\s*:\s*$/i,
  /^am\b.{0,200}\bschrieb\b.{0,100}:\s*$/i,
  /^el\b.{0,200}\bescribió\s*:\s*$/i,
  /^op\b.{0,200}\bschreef\b.{0,100}:\s*$/i,
];

/** "From: … / Sent: …" (Outlook) — a From line followed within two lines by Sent/Date. */
function outlookHeaderAt(lines: string[], i: number): boolean {
  if (!/^\*?from:\*?\s/i.test(lines[i])) return false;
  return lines.slice(i + 1, i + 4).some((l) => /^\*?(sent|date|to|subject):\*?\s/i.test(l));
}

/** Our own unsubscribe footer (a line with an unsubscribe link). */
const FOOTER = /unsubscribe\b.*(https?:\/\/|\/api\/u\/|\{\{\s*unsubscribe_url\s*\}\})|^to stop receiving these emails, reply "unsubscribe"\.?$/i;

export function newReplyText(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const wrappedOn = /^on\b/i.test(line) && !/wrote:\s*$/i.test(line) && /^wrote:\s*$/i.test((lines[i + 1] ?? "").trim());
    const header = QUOTE_HEADERS.some((re, k) => (k === 1 ? wrappedOn : re.test(line))) || outlookHeaderAt(lines.map((l) => l.trim()), i);
    if (header) break;
    if (line.startsWith(">")) continue;
    if (FOOTER.test(line)) continue;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}
