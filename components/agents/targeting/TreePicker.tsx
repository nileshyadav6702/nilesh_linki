import { useState } from "react";
import { RiAddLine, RiArrowDownSLine, RiArrowRightSLine, RiCheckLine } from "react-icons/ri";
import type { TreeNode } from "@/lib/icp/data/tree";
import PickerShell from "@/components/agents/targeting/PickerShell";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

interface Row { key: string; label: string; value: string; depth: 0 | 1; node?: TreeNode; last?: boolean }

/**
 * Two-level searchable picker (industries, locations). Parents and children select independently;
 * a parent's chevron expands it. Searching shows matching parents and matching children under
 * their parent. `childValue` sets what a child stores (e.g. "California, United States").
 */
export default function TreePicker({ label, nodes, selected, onToggle, onClose, placeholder, childValue = (c) => c }: {
  label: string; nodes: TreeNode[]; selected: string[]; onToggle: (value: string) => void; onClose: () => void; placeholder: string;
  childValue?: (child: string, parent: string) => string;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const q = query.trim().toLowerCase();
  const isOn = (v: string) => selected.some((s) => same(s, v));

  const rows: Row[] = [];
  for (const node of nodes) {
    const kids = node.children ?? [];
    const parentHit = !q || node.label.toLowerCase().includes(q);
    const kidHits = q ? kids.filter((k) => k.toLowerCase().includes(q)) : [];
    if (!parentHit && !kidHits.length) continue;
    rows.push({ key: node.label, label: node.label, value: node.label, depth: 0, node });
    const open = expanded.has(node.label);
    const shown = open ? kids : kidHits;
    shown.forEach((k, i) => rows.push({ key: `${node.label}/${k}`, label: k, value: childValue(k, node.label), depth: 1, last: i === shown.length - 1 }));
  }
  const exact = rows.find((r) => same(r.label, q) || same(r.value, q));

  function enter() {
    if (!q) return;
    const value = exact?.value ?? query.trim();
    if (!isOn(value)) onToggle(value);
    setQuery("");
  }
  const toggleOpen = (k: string) => setExpanded((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <PickerShell label={label} query={query} onQuery={setQuery} onEnter={enter} onClose={onClose} placeholder={placeholder}>
      {q && !exact && (
        <button type="button" data-row onClick={enter} className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2.5 text-left text-sm text-primary hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:outline-none">
          <RiAddLine size={16} /> Add &ldquo;{query.trim()}&rdquo;
        </button>
      )}
      <ul role="list">
        {rows.map((r) => {
          const on = isOn(r.value);
          const kids = r.node?.children?.length ?? 0;
          const open = r.node ? expanded.has(r.node.label) : false;
          return (
            <li key={r.key} className={`relative flex items-center ${r.depth ? "pl-9" : ""}`}>
              {r.depth === 1 && (
                <>
                  <span aria-hidden="true" className={`absolute left-[19px] top-0 w-px bg-[var(--border-subtle)] ${r.last ? "h-1/2" : "h-full"}`} />
                  <span aria-hidden="true" className="absolute left-[19px] top-1/2 h-px w-3 bg-[var(--border-subtle)]" />
                </>
              )}
              {r.depth === 0 && (
                kids ? (
                  <button type="button" onClick={() => toggleOpen(r.value)} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${r.label}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-base-content/45 hover:bg-base-200 hover:text-base-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                    {open ? <RiArrowDownSLine size={16} /> : <RiArrowRightSLine size={16} />}
                  </button>
                ) : <span className="w-8 shrink-0" />
              )}
              <button type="button" data-row aria-pressed={on} onClick={() => onToggle(r.value)}
                className={`flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[8px] px-3 py-2.5 text-left text-[15px] focus-visible:bg-base-200 focus-visible:outline-none ${on ? "text-primary" : "text-base-content/85 hover:bg-base-200/70"}`}>
                <span className="truncate">{r.label}</span>
                {on ? <RiCheckLine size={16} className="shrink-0" aria-hidden="true" /> : kids > 0 && <span className="shrink-0 text-[13px] tabular-nums text-base-content/40">{kids}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {!rows.length && !q && <p className="px-3 py-4 text-sm text-base-content/45">Nothing to pick.</p>}
    </PickerShell>
  );
}
