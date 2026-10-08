import { useEffect, useRef, useState, type ReactNode } from "react";
import { RiBold, RiFormatClear, RiItalic, RiLink, RiListOrdered, RiListUnordered, RiUnderline } from "react-icons/ri";

/** Rich-text email signature: a small contentEditable editor with a formatting toolbar. */

export const SIGNATURE_MAX = 2000;
const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "A", "BR", "P", "DIV"]);

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Stored signatures may be plain text: keep their line breaks. */
export function signatureToHtml(value: string | null | undefined): string {
  const v = value ?? "";
  if (!v.trim()) return "";
  return /<[a-z][\s\S]*>/i.test(v) ? sanitizeSignature(v) : escapeHtml(v).replace(/\r?\n/g, "<br>");
}

/** Keep only basic formatting tags; drop every attribute except an http(s) href. */
export function sanitizeSignature(html: string): string {
  if (typeof window === "undefined") return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return "";
  const clean = (el: Element) => {
    for (const child of Array.from(el.children)) {
      clean(child);
      if (!ALLOWED.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      const href = child.tagName === "A" ? child.getAttribute("href") : null;
      for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
      if (href && /^https?:\/\//i.test(href)) { child.setAttribute("href", href); child.setAttribute("target", "_blank"); child.setAttribute("rel", "noreferrer"); }
    }
  };
  clean(root);
  return root.innerHTML.trim();
}

export function plainLength(html: string): number {
  if (typeof window === "undefined") return html.length;
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent ?? "").length;
}

function ToolBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-[6px] text-base-content/70 hover:bg-base-200 hover:text-base-content">{children}</button>
  );
}

export default function SignatureEditor({ initialHtml, onChange }: { initialHtml: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  // Mounted once the signature is loaded; remount (key) to load a different one.
  const [count, setCount] = useState(() => plainLength(initialHtml));
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("https://");
  const [empty, setEmpty] = useState(() => plainLength(initialHtml) === 0 && !/<(ul|ol|li)/i.test(initialHtml));

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml;
  }, [initialHtml]);

  const sync = () => {
    const html = ref.current?.innerHTML ?? "";
    const n = (ref.current?.textContent ?? "").length;
    setCount(n);
    setEmpty(n === 0 && !/<(ul|ol|li)/i.test(html));
    onChange(html);
  };
  const exec = (cmd: string, arg?: string) => { ref.current?.focus(); document.execCommand(cmd, false, arg); sync(); };

  function openLink() {
    const sel = window.getSelection();
    savedRange.current = sel && sel.rangeCount && ref.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    setUrl("https://");
    setLinking(true);
  }
  function applyLink() {
    const href = url.trim();
    setLinking(false);
    if (!/^https?:\/\/\S+\.\S+/i.test(href)) return;
    ref.current?.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) { sel.removeAllRanges(); sel.addRange(savedRange.current); }
    if (sel && !sel.isCollapsed) document.execCommand("createLink", false, href);
    else document.execCommand("insertHTML", false, `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`);
    sync();
  }

  return (
    <div>
      <div className="overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-base-100 focus-within:border-[var(--border-focus)]">
        <div className="relative flex flex-wrap items-center gap-0.5 border-b border-[var(--border-subtle)] px-2 py-1.5">
          <ToolBtn label="Bold" onClick={() => exec("bold")}><RiBold size={17} /></ToolBtn>
          <ToolBtn label="Italic" onClick={() => exec("italic")}><RiItalic size={17} /></ToolBtn>
          <ToolBtn label="Underline" onClick={() => exec("underline")}><RiUnderline size={17} /></ToolBtn>
          <span className="mx-1.5 h-5 w-px bg-[var(--border-subtle)]" />
          <ToolBtn label="Bulleted list" onClick={() => exec("insertUnorderedList")}><RiListUnordered size={17} /></ToolBtn>
          <ToolBtn label="Numbered list" onClick={() => exec("insertOrderedList")}><RiListOrdered size={17} /></ToolBtn>
          <span className="mx-1.5 h-5 w-px bg-[var(--border-subtle)]" />
          <ToolBtn label="Insert link" onClick={openLink}><RiLink size={17} /></ToolBtn>
          <ToolBtn label="Clear formatting" onClick={() => { exec("removeFormat"); exec("unlink"); }}><RiFormatClear size={17} /></ToolBtn>
          {linking && (
            <div className="absolute left-2 top-full z-20 mt-1 flex w-[320px] max-w-[calc(100%-1rem)] items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-base-100 p-2 shadow-[var(--shadow-overlay)]">
              <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } if (e.key === "Escape") setLinking(false); }}
                className="h-8 min-w-0 flex-1 rounded-[6px] border border-[var(--border-subtle)] bg-base-100 px-2 text-sm outline-none focus:border-[var(--border-focus)]" />
              <button type="button" onClick={applyLink} className="h-8 rounded-[6px] bg-primary px-3 text-xs font-medium text-primary-content">Add</button>
              <button type="button" onClick={() => setLinking(false)} className="h-8 rounded-[6px] px-2 text-xs text-base-content/60 hover:bg-base-200">Cancel</button>
            </div>
          )}
        </div>
        <div className="relative">
          {empty && <div className="pointer-events-none absolute left-4 top-3 whitespace-pre-line text-sm italic text-base-content/40">{"Best regards,\nYour name"}</div>}
          <div ref={ref} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Email signature"
            onInput={sync}
            onKeyDown={(e) => {
              const special = e.key.length > 1 || e.ctrlKey || e.metaKey;
              if (!special && count >= SIGNATURE_MAX) e.preventDefault();
            }}
            onPaste={(e) => {
              e.preventDefault();
              const text = e.clipboardData.getData("text/plain").slice(0, Math.max(0, SIGNATURE_MAX - count));
              document.execCommand("insertText", false, text);
            }}
            className="min-h-[180px] px-4 py-3 text-sm leading-relaxed text-base-content outline-none [&_a]:text-primary [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" />
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-base-content/45">
        <span>Maximum {SIGNATURE_MAX} characters</span>
        <span className={`tabular-nums ${count >= SIGNATURE_MAX ? "text-error" : ""}`}>{count}/{SIGNATURE_MAX}</span>
      </div>
    </div>
  );
}
