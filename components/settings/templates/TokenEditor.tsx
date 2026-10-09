import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { LuBold, LuChevronDown, LuItalic, LuLink, LuList, LuListOrdered, LuPlus, LuRemoveFormatting, LuUnderline } from "react-icons/lu";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { chipHtml, fromDom, GROUPS, labelOf, toHtml, TONE_CLS } from "@/components/settings/templates/tokens";

/**
 * Text editor with variable chips. Type "/" (or use "Insert variable") to add {{Token}}s, which
 * show as coloured chips. `rich` adds a formatting toolbar and stores HTML (email bodies).
 */

export interface TokenEditorHandle { insert(token: string): void; focus(): void }

function VariableMenu({ at, onPick, onClose }: { at: { x: number; y: number }; onPick: (t: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, [ref], onClose);
  const [active, setActive] = useState(0);
  const flat = GROUPS.flatMap((g) => [...g.items]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); onPick(flat[active]); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, flat, onClose, onPick]);
  useEffect(() => { ref.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
  // Stay on screen: open above the caret when there is no room below.
  const top = at.y + 300 > window.innerHeight ? Math.max(8, at.y - 330) : at.y + 8;
  let i = -1;
  return createPortal(
    <div ref={ref} role="listbox" aria-label="Variables" style={{ left: Math.min(at.x, window.innerWidth - 380), top }}
      className="wizard-rise fixed z-[80] max-h-[320px] w-[360px] overflow-y-auto rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-2 shadow-[var(--shadow-overlay)]">
      <div className="px-2 pb-1 pt-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-base-content/45 [text-transform:uppercase]">Variables</div>
      {GROUPS.map((g) => (
        <div key={g.group} className="pb-1">
          <div className="px-2 pb-1 pt-2 text-[12px] font-semibold tracking-[0.06em] text-base-content/45 [text-transform:uppercase]">{g.group}</div>
          {g.items.map((t) => {
            i++; const idx = i;
            return (
              <button key={t} type="button" role="option" aria-selected={idx === active} data-i={idx} onMouseEnter={() => setActive(idx)} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(t)}
                className={`flex w-full rounded-[8px] px-2 py-1.5 text-left ${idx === active ? "bg-primary/[0.08]" : ""}`}>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[14px] ${TONE_CLS[g.tone]}`}>{labelOf(t)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export default function TokenEditor({ value, onChange, rich = false, singleLine = false, placeholder, minHeight = 240, className = "", handle, count }: {
  value: string; onChange: (v: string) => void; rich?: boolean; singleLine?: boolean; placeholder: string; minHeight?: number; className?: string;
  handle?: Ref<TokenEditorHandle>; count?: { n: number; max: number };
}) {
  const root = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  const saved = useRef<Range | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Only rewrite the DOM when the value changed from outside (example picked, template loaded).
  useEffect(() => {
    if (!root.current || value === last.current) return;
    root.current.innerHTML = toHtml(value, rich);
    last.current = value;
  }, [value, rich]);

  const emit = () => {
    if (!root.current) return;
    const v = fromDom(root.current, rich);
    last.current = v;
    onChange(v);
  };
  const remember = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && root.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
  };
  const insert = (token: string) => {
    const el = root.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    let range = saved.current;
    if (!range || !el.contains(range.startContainer)) { range = document.createRange(); range.selectNodeContents(el); range.collapse(false); }
    sel?.removeAllRanges(); sel?.addRange(range);
    const tmp = document.createElement("span");
    tmp.innerHTML = chipHtml(token);
    const chip = tmp.firstChild as Node;
    const space = document.createTextNode(" ");
    range.deleteContents();
    range.insertNode(space);
    range.insertNode(chip);
    const after = document.createRange();
    after.setStartAfter(space); after.collapse(true);
    sel?.removeAllRanges(); sel?.addRange(after);
    saved.current = after.cloneRange();
    emit();
  };
  useImperativeHandle(handle, () => ({ insert, focus: () => root.current?.focus() }));

  const fmt = (cmd: string, arg?: string) => { root.current?.focus(); document.execCommand(cmd, false, arg); emit(); };
  const toolBtn = "flex h-9 w-9 items-center justify-center rounded-[8px] text-base-content/75 hover:bg-base-200 hover:text-base-content";

  return (
    <div className={className}>
      {rich && (
        <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] px-3 py-2">
          <button type="button" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => fmt("bold")} aria-label="Bold"><LuBold size={19} /></button>
          <button type="button" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => fmt("italic")} aria-label="Italic"><LuItalic size={19} /></button>
          <button type="button" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => fmt("underline")} aria-label="Underline"><LuUnderline size={19} /></button>
          <span className="mx-1.5 h-5 w-px bg-[var(--border-subtle)]" />
          <button type="button" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => fmt("insertUnorderedList")} aria-label="Bulleted list"><LuList size={19} /></button>
          <button type="button" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => fmt("insertOrderedList")} aria-label="Numbered list"><LuListOrdered size={19} /></button>
          <span className="mx-1.5 h-5 w-px bg-[var(--border-subtle)]" />
          <button type="button" className={toolBtn} onMouseDown={(e) => e.preventDefault()} aria-label="Link"
            onClick={() => { const url = window.prompt("Link URL (https://…)"); if (url && /^https?:\/\//i.test(url.trim())) fmt("createLink", url.trim()); }}><LuLink size={19} /></button>
          <button type="button" className={toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => fmt("removeFormat")} aria-label="Clear formatting"><LuRemoveFormatting size={19} /></button>
        </div>
      )}
      <div className="relative">
        {!value.replace(/<[^>]*>/g, "").trim() && <div className={`pointer-events-none absolute left-0 top-0 text-base-content/40 ${rich ? "px-5 py-4 italic" : singleLine ? "" : "px-5 py-4"}`}>{placeholder}</div>}
        <div ref={root} contentEditable suppressContentEditableWarning role="textbox" aria-multiline={!singleLine} aria-label={placeholder}
          style={singleLine ? undefined : { minHeight }}
          onInput={emit} onKeyUp={remember} onMouseUp={remember} onBlur={remember}
          onKeyDown={(e) => {
            if (singleLine && e.key === "Enter") { e.preventDefault(); return; }
            if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              remember();
              const r = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
              const box = root.current!.getBoundingClientRect();
              setMenu({ x: r && r.left ? r.left : box.left + 16, y: r && r.bottom ? r.bottom : box.top + 24 });
            }
          }}
          onPaste={(e) => { if (!rich) { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); } }}
          className={`outline-none ${singleLine ? "whitespace-nowrap" : "whitespace-pre-wrap break-words px-5 py-4"} text-[17px] leading-[1.75] text-base-content [&_a]:text-[#5b4fd6] [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_p]:pb-3`} />
      </div>
      {!singleLine && (
        <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] bg-base-200/30 px-5 py-3">
          <InsertMenu onPick={insert} />
          <span className="text-[14px] text-base-content/50">or type <kbd className="ml-1 rounded-[5px] border border-[var(--border-strong)] bg-base-100 px-1.5 text-[13px]">/</kbd></span>
          {count && <span className={`ml-auto text-[14px] tabular-nums ${count.n > count.max ? "text-error" : "text-base-content/50"}`}>{count.n} / {count.max}</span>}
        </div>
      )}
      {menu && <VariableMenu at={menu} onPick={(t) => { setMenu(null); insert(t); }} onClose={() => { setMenu(null); root.current?.focus(); }} />}
    </div>
  );
}

/** "+ Insert variable ▾" button that opens the same menu. */
function InsertMenu({ onPick }: { onPick: (t: string) => void }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ x: r.left, y: r.bottom }); }}
        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[14px] font-medium text-base-content/80 hover:bg-base-200">
        <LuPlus size={16} />Insert variable<LuChevronDown size={15} />
      </button>
      {at && <VariableMenu at={at} onPick={(t) => { setAt(null); onPick(t); }} onClose={() => setAt(null)} />}
    </>
  );
}
