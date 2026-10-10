import { useEffect, useMemo, useState } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type ColumnSizingState } from "@tanstack/react-table";
import { RiCloseLine, RiDeleteBin6Line, RiLinkedinBoxFill, RiMore2Fill, RiPushpinFill, RiPushpinLine } from "react-icons/ri";
import { OutreachCell, SignalCell } from "@/components/agents/leads/cells";
import { FloatingMenu } from "@/components/agents/leads/Menu";
import { timeAgo } from "@/components/agents/ui";
import { ApprovalCell, EmailCell, PhoneCell, ScoreCell } from "@/components/contacts/cells";
import type { ContactRow } from "@/components/contacts/useContacts";
import Checkbox from "@/components/contacts/Checkbox";

/** The All contacts grid: resizable columns (remembered per browser), a pinnable contact column, row actions. */

const SIZES_KEY = "linki.contacts.columns.v1";
const CHECK_W = 56;
const NO_HIDDEN: string[] = [];

function ContactAvatar({ name, src }: { name: string | null; src?: string | null }) {
  const initials = (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img src={src} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-[var(--border-subtle)]" />;
  return <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f08a6c] to-[#e2603f] text-[15px] font-medium text-white">{initials}</span>;
}

function RowMenu({ row, onRemove, onDelete }: { row: ContactRow; onRemove: () => void; onDelete: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" aria-label={`Actions for ${row.full_name ?? "contact"}`} aria-haspopup="menu" aria-expanded={!!anchor}
        onClick={(e) => { e.stopPropagation(); setAnchor(anchor ? null : e.currentTarget); }}
        className="rounded-[8px] p-2 text-base-content/55 hover:bg-base-200 hover:text-base-content"><RiMore2Fill size={18} /></button>
      {anchor && (
        <FloatingMenu anchor={anchor} label="Contact actions" onClose={() => setAnchor(null)} width={280} items={[
          { label: "Remove from List & Campaign", icon: <RiCloseLine size={18} />, onSelect: onRemove },
          { label: "Permanently Delete", icon: <RiDeleteBin6Line size={18} />, onSelect: onDelete, danger: true },
        ]} />
      )}
    </>
  );
}

export interface ResearchResult { verdict: string; summary: string | null }

const VERDICT: Record<string, { label: string; cls: string }> = {
  match: { label: "Match", cls: "bg-success/15 text-[#2f7a43]" },
  no_match: { label: "No match", cls: "bg-error/10 text-error" },
  unknown: { label: "Unclear", cls: "bg-base-200 text-base-content/60" },
};

export default function ContactsTable({ rows, selected, toggle, toggleAll, onOpen, onDecide, onRemove, onDelete, onChanged, research, hidden = NO_HIDDEN, sizesKey = SIZES_KEY }: {
  rows: ContactRow[]; selected: Set<string>; toggle: (id: string) => void; toggleAll: (on: boolean) => void;
  onOpen: (id: string) => void; onDecide: (id: string, d: "approve" | "reject") => Promise<void>;
  onRemove: (id: string) => void; onDelete: (id: string) => void; onChanged: () => void;
  /** List view: per-contact deep research results; adds a "Research result" column. */
  research?: Record<string, ResearchResult>;
  /** Column ids to leave out (e.g. "list" inside a list). */
  hidden?: string[];
  sizesKey?: string;
}) {
  const [pinned, setPinned] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [sizing, setSizing] = useState<ColumnSizingState>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(window.localStorage.getItem(sizesKey) ?? "{}") as ColumnSizingState; } catch { return {}; }
  });
  useEffect(() => { try { window.localStorage.setItem(sizesKey, JSON.stringify(sizing)); } catch { /* storage unavailable */ } }, [sizing, sizesKey]);

  const columns = useMemo<ColumnDef<ContactRow>[]>(() => ([
    {
      id: "contact", header: "Contact", size: 380, minSize: 260, maxSize: 640,
      cell: ({ row: { original: r } }) => (
        <div className="flex min-w-0 items-center gap-3.5">
          <ContactAvatar name={r.full_name} src={r.profile_image_url} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(r.id); }} className="truncate text-left text-[16px] text-[#4f46e5] hover:underline">{r.full_name ?? "Unknown"}</button>
              {r.linkedin_url && <a href={r.linkedin_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="LinkedIn profile" className="shrink-0 text-[#3730a3] hover:opacity-80"><RiLinkedinBoxFill size={18} /></a>}
            </div>
            <div className="truncate text-[14px] text-base-content/70">{r.title ?? r.headline}</div>
            {r.company && (
              <div className="flex min-w-0 items-center gap-1.5 text-[14px] text-base-content/55">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {r.company_logo ? <img src={r.company_logo} alt="" width={16} height={16} className="h-4 w-4 shrink-0 rounded-[4px] object-cover ring-1 ring-[var(--border-subtle)]" /> : <span className="text-base-content/35">@</span>}
                <span className="truncate">{r.company}</span>
              </div>
            )}
          </div>
        </div>
      ),
    },
    { id: "signal", header: "Signal", size: 320, minSize: 160, maxSize: 640, cell: ({ row: { original: r } }) => <SignalCell lead={r} /> },
    { id: "score", header: "AI Score", size: 150, minSize: 110, maxSize: 260, cell: ({ row: { original: r } }) => <div className="flex justify-center"><ScoreCell row={r} /></div> },
    ...(research ? [{
      id: "research", header: "Research result", size: 220, minSize: 130, maxSize: 480,
      cell: ({ row: { original: r } }: { row: { original: ContactRow } }) => {
        const res = research[r.id];
        if (!res) return <span className="text-[14px] text-base-content/40">Not researched</span>;
        const v = VERDICT[res.verdict] ?? VERDICT.unknown;
        return <span className="flex min-w-0 items-center gap-2" title={res.summary ?? undefined}><span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[13px] ${v.cls}`}>{v.label}</span><span className="truncate text-[13px] text-base-content/55">{res.summary}</span></span>;
      },
    } as ColumnDef<ContactRow>] : []),
    { id: "email", header: "Email", size: 130, minSize: 100, maxSize: 280, cell: ({ row: { original: r } }) => <div className="flex justify-center"><EmailCell row={r} onFound={onChanged} /></div> },
    { id: "phone", header: "Phone", size: 130, minSize: 100, maxSize: 280, cell: ({ row: { original: r } }) => <div className="flex justify-center"><PhoneCell row={r} /></div> },
    { id: "outreach", header: "Outreach step", size: 430, minSize: 300, maxSize: 600, cell: ({ row: { original: r } }) => <OutreachCell outreach={r.outreach} /> },
    { id: "imported", header: "Import date", size: 150, minSize: 110, maxSize: 260, cell: ({ row: { original: r } }) => <span className="whitespace-nowrap text-[14px] text-base-content/65">{timeAgo(r.created_at)}</span> },
    {
      id: "list", header: "List", size: 210, minSize: 120, maxSize: 420,
      cell: ({ row: { original: r } }) => r.list_name
        ? <span className="flex min-w-0 items-center gap-1.5 text-[14px]"><span className="truncate">{r.list_name}</span>{r.list_count > 1 && <span className="shrink-0 rounded-full bg-base-200 px-1.5 text-[12px] text-base-content/55">+{r.list_count - 1}</span>}</span>
        : <span className="text-[13px] text-base-content/30">—</span>,
    },
    { id: "agent", header: "Agent", size: 180, minSize: 110, maxSize: 360, cell: ({ row: { original: r } }) => <span className="block truncate text-[14px] text-base-content/70">{r.agent_name ?? "—"}</span> },
    { id: "approval", header: "Approval", size: 230, minSize: 180, maxSize: 360, cell: ({ row: { original: r } }) => <div className="flex justify-center"><ApprovalCell row={r} onDecide={onDecide} /></div> },
    { id: "actions", header: "Actions", size: 100, minSize: 90, maxSize: 140, enableResizing: false, cell: ({ row: { original: r } }) => <div className="flex justify-center"><RowMenu row={r} onRemove={() => onRemove(r.id)} onDelete={() => onDelete(r.id)} /></div> },
  ] as ColumnDef<ContactRow>[]).filter((c) => !hidden.includes(String(c.id))), [onOpen, onDecide, onRemove, onDelete, onChanged, research, hidden]);

  // TanStack Table returns fresh functions each render by design; nothing here memoizes them.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows, columns, getCoreRowModel: getCoreRowModel(), getRowId: (r) => r.id,
    columnResizeMode: "onChange", enableColumnResizing: true, state: { columnSizing: sizing }, onColumnSizingChange: setSizing,
  });

  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOn = !allOn && rows.some((r) => selected.has(r.id));
  const width = CHECK_W + table.getTotalSize();
  const stickyContact = (bg: string) => (pinned ? `sticky z-10 ${bg} ${scrolled ? "shadow-[6px_0_10px_-6px_rgba(20,20,19,0.18)]" : ""}` : "");

  return (
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain" onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}>
      <table className="border-separate border-spacing-0 text-left" style={{ width, minWidth: "100%", tableLayout: "fixed" }}>
        <colgroup><col style={{ width: CHECK_W }} />{table.getVisibleLeafColumns().map((c) => <col key={c.id} style={{ width: c.getSize() }} />)}</colgroup>
        <thead className="sticky top-0 z-20">
          {table.getHeaderGroups().map((g) => (
            <tr key={g.id}>
              <th className={`border-b border-[var(--border-subtle)] bg-base-200 py-4 pl-5 ${pinned ? "sticky left-0 z-20" : ""}`}>
                <Checkbox label="Select all on this page" checked={allOn} indeterminate={someOn} onChange={toggleAll} />
              </th>
              {g.headers.map((h) => {
                const isContact = h.column.id === "contact";
                return (
                  <th key={h.id} style={isContact && pinned ? { left: CHECK_W } : undefined}
                    className={`group/h relative border-b border-[var(--border-subtle)] bg-base-200 px-4 py-4 text-[15.5px] font-medium caps text-base-content/70 ${["score", "email", "phone", "approval", "actions"].includes(h.column.id) ? "text-center" : ""} ${isContact ? stickyContact("bg-base-200") : ""}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate ${["score", "email", "phone", "approval", "actions"].includes(h.column.id) ? "w-full text-center" : ""}`}>{flexRender(h.column.columnDef.header, h.getContext())}</span>
                      {isContact && (
                        <button type="button" onClick={() => setPinned(!pinned)} aria-pressed={pinned} title={pinned ? "Unpin column" : "Pin column"}
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] ${pinned ? "bg-primary/15 text-primary" : "text-base-content/40 hover:bg-base-300"}`}>
                          {pinned ? <RiPushpinFill size={16} /> : <RiPushpinLine size={16} />}
                        </button>
                      )}
                    </span>
                    {h.column.getCanResize() && (
                      <span role="separator" aria-orientation="vertical" aria-label={`Resize ${String(h.column.columnDef.header)} column`}
                        onMouseDown={h.getResizeHandler()} onTouchStart={h.getResizeHandler()} onDoubleClick={() => h.column.resetSize()}
                        className={`absolute right-0 top-2 bottom-2 w-1.5 cursor-col-resize rounded-full transition-colors ${h.column.getIsResizing() ? "bg-[#5b4fd6]" : "bg-transparent group-hover/h:bg-[var(--border-strong)]"}`} />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => {
            const on = selected.has(r.id);
            // Opaque tints (mixed with the canvas): the pinned contact column must hide what scrolls under it.
            const bg = on
              ? "bg-[color-mix(in_srgb,var(--color-primary)_8%,var(--color-base-100))]"
              : "bg-base-100 group-hover:bg-[color-mix(in_srgb,var(--color-base-200)_70%,var(--color-base-100))]";
            return (
              <tr key={r.id} className="group cursor-pointer" onClick={() => onOpen(r.id)}>
                <td className={`border-b border-[var(--border-subtle)] py-4 pl-5 align-middle ${bg} ${pinned ? "sticky left-0 z-10" : ""}`} onClick={(e) => e.stopPropagation()}>
                  <Checkbox label={`Select ${r.original.full_name ?? "contact"}`} checked={on} onChange={() => toggle(r.id)} />
                </td>
                {r.getVisibleCells().map((c) => {
                  const isContact = c.column.id === "contact";
                  return (
                    <td key={c.id} style={isContact && pinned ? { left: CHECK_W } : undefined}
                      className={`overflow-hidden border-b border-[var(--border-subtle)] px-4 py-4 align-middle transition-colors ${bg} ${isContact ? stickyContact(bg) : ""}`}>
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
