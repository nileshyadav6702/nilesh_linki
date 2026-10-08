import { toPlainText } from "@/lib/email/content";

/**
 * A signature saved from the rich-text editor, as the plain text appended to campaign emails:
 * links keep their URL ("text (url)"), list items become bullets. Plain-text signatures are
 * returned unchanged.
 */
export function signatureText(sig: string): string {
  if (!/<[a-z][\s\S]*>/i.test(sig)) return sig;
  const prepared = sig
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, "").trim();
      return !label || label === href ? href : `${label} (${href})`;
    })
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<\/(li|div)>/gi, "\n");
  return toPlainText(prepared);
}
