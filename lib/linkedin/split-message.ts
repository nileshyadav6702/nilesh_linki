/**
 * "Split messages into a conversation" (Campaign settings): a LinkedIn message with several
 * paragraphs goes out as 2-4 shorter messages, the way people chat. Splits only on paragraph
 * breaks, so sentences are never cut; a single-paragraph message is sent as is.
 */

export const MAX_PARTS = 4;

export function splitMessage(text: string): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length < 2) return [text.trim()].filter(Boolean);
  if (paras.length <= MAX_PARTS) return paras;
  // Too many paragraphs: keep the first three as they are and send the rest together.
  return [...paras.slice(0, MAX_PARTS - 1), paras.slice(MAX_PARTS - 1).join("\n\n")];
}

/** Pause between parts, in ms: a few seconds, like someone typing the next line. */
export const partDelayMs = () => 3000 + Math.round(Math.random() * 3000);
