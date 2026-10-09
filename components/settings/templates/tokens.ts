/** Variable chips for the template editor: groups, colours, and text ⇄ HTML conversion. */

export const GROUPS = [
  { group: "Lead data", tone: "lead", items: ["FirstName", "LastName", "Company", "JobTitle"] },
  { group: "Sender data", tone: "sender", items: ["SenderFirstName", "SenderName", "SenderFullName", "SenderCompany"] },
  { group: "Signals", tone: "signal", items: ["Intent"] },
  { group: "AI blocks", tone: "ai", items: ["AI:Mention Recent Activity", "AI:Reference their role", "AI:Personalize with company context"] },
  { group: "CTA", tone: "cta", items: ["CTA"] },
] as const;
export type Tone = (typeof GROUPS)[number]["tone"];

// Literal class strings (Tailwind scans them); chips are inserted as raw HTML.
export const TONE_CLS: Record<Tone, string> = {
  lead: "border-[#d9d0fb] bg-[#efeafd] text-[#5b3fd6]",
  sender: "border-[#f6c4b4] bg-[#fde8e0] text-[#c2410c]",
  signal: "border-[#f0c8f3] bg-[#fbe8fc] text-[#a01aa8]",
  ai: "border-[#f0dccd] bg-[#fbf0e7] text-[#5c4a3d]",
  cta: "border-[#bfe6c8] bg-[#e5f6e9] text-[#1f7a3d]",
};
const CHIP_BASE = "mx-0.5 inline-flex items-center rounded-full border px-2.5 py-px align-baseline text-[0.92em] leading-6 select-none whitespace-nowrap";

export const toneOf = (token: string): Tone => (GROUPS.find((g) => (g.items as readonly string[]).includes(token))?.tone ?? "lead") as Tone;
export const labelOf = (token: string) => token.replace(/^AI:/, "");
export const chipClass = (token: string) => `${CHIP_BASE} ${TONE_CLS[toneOf(token)]}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const chipHtml = (token: string) => `<span contenteditable="false" data-token="${esc(token)}" class="${chipClass(token)}">${esc(labelOf(token))}</span>`;

/** Stored text → editor HTML. Plain text keeps line breaks; rich text is already HTML. */
export function toHtml(value: string, rich: boolean): string {
  const base = rich ? value : esc(value).replace(/\n/g, "<br>");
  return base.replace(/\{\{([^}<>]+)\}\}/g, (_, t: string) => chipHtml(t));
}

/** Editor DOM → stored text with {{Token}}s (plain) or HTML with {{Token}}s (rich). */
export function fromDom(root: HTMLElement, rich: boolean): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-token]").forEach((el) => el.replaceWith(document.createTextNode(`{{${el.getAttribute("data-token")}}}`)));
  if (rich) {
    const html = clone.innerHTML.replace(/<br\s*\/?>$/i, "");
    return html === "<br>" ? "" : html;
  }
  // Plain: blocks and <br> become newlines.
  let text = "";
  const walk = (n: Node) => {
    n.childNodes.forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE) text += c.textContent ?? "";
      else if (c.nodeName === "BR") text += "\n";
      else { const block = /^(DIV|P)$/.test(c.nodeName); if (block && text && !text.endsWith("\n")) text += "\n"; walk(c); }
    });
  };
  walk(clone);
  return text.replace(/ /g, " ").replace(/\n$/, "");
}

/** Visible length (tokens count as their label; tags don't count). */
export function visibleLength(text: string): number {
  return text.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&[a-z]+;/g, "x").replace(/\{\{(?:AI:)?([^}]+)\}\}/g, "$1").length;
}
