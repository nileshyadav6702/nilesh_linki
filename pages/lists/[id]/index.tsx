import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RiArrowDownSLine, RiArrowLeftSLine, RiDeleteBin6Line, RiDownload2Line, RiListUnordered, RiLoader4Line, RiPencilLine, RiSearchLine } from "react-icons/ri";
import LeadDrawer from "@/components/agents/LeadDrawer";
import { useDismiss } from "@/components/agents/leads/Listbox";
import Confirm from "@/components/contacts/Confirm";
import ContactsTable, { type ResearchResult } from "@/components/contacts/ContactsTable";
import Pagination from "@/components/contacts/Pagination";
import { useContacts, type ContactRow } from "@/components/contacts/useContacts";
import DeepResearchDrawer from "@/components/lists/DeepResearchDrawer";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

interface ListInfo { id: string; name: string; target_count: number }
interface Research { run: { status: string; total: number; done_count: number; finished_at: string | null; started_at: string; criteria: string[]; error: string | null } | null; results: Record<string, ResearchResult>; companies: number }

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `Request failed (${r.status})`);
  return d;
}

function csv(rows: ContactRow[], research: Record<string, ResearchResult>, name: string) {
  const cols: Array<[string, (r: ContactRow) => unknown]> = [
    ["name", (r) => r.full_name], ["title", (r) => r.title ?? r.headline], ["company", (r) => r.company], ["email", (r) => r.email], ["phone", (r) => r.phone],
    ["linkedin", (r) => r.linkedin_url], ["score", (r) => r.lead_score ?? r.intent_score], ["research", (r) => research[r.id]?.verdict], ["research_notes", (r) => research[r.id]?.summary],
  ];
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([[cols.map(([c]) => c).join(","), ...rows.map((r) => cols.map(([, f]) => cell(f(r))).join(","))].join("\n")], { type: "text/csv" }));
  a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

const fmtDate = (s: string) => new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function MoveMenu({ lists, currentId, disabled, onMove }: { lists: ListInfo[]; currentId: string; disabled: boolean; onMove: (l: ListInfo) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  return (
    <div ref={wrap} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open}
        className={`inline-flex h-11 items-center gap-2 rounded-[8px] border px-4 text-[15px] ${open ? "border-base-content/70" : "border-[var(--border-subtle)] hover:bg-base-200"}`}>
        Move to list <RiArrowDownSLine size={18} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="wizard-rise absolute right-0 top-full z-40 mt-2 max-h-[420px] w-[340px] overflow-y-auto rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1 shadow-[var(--shadow-overlay)]">
          {lists.map((l) => (
            <button key={l.id} type="button" disabled={l.id === currentId} onClick={() => { setOpen(false); onMove(l); }}
              className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left text-[15px] hover:bg-base-200 disabled:cursor-not-allowed disabled:text-base-content/35 disabled:hover:bg-transparent">
              <RiListUnordered size={18} className="shrink-0 text-base-content/55" /><span className="min-w-0">{l.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One list: its contacts in the shared table, deep research, rename, move / remove / export. */
export default function ListDetail() {
  const router = useRouter();
  const id = String(router.query.id ?? "");
  const base = useMemo(() => ({ list: id }), [id]);
  const c = useContacts(base);
  const rows = useMemo(() => c.rows ?? [], [c.rows]);
  const [list, setList] = useState<ListInfo | null>(null);
  const [lists, setLists] = useState<ListInfo[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [qText, setQText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<string | null>(null);
  const [research, setResearch] = useState<Research | null>(null);
  const [researchOpen, setResearchOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const sel = [...selected];

  const loadLists = useCallback(() => fetch("/api/lists").then((r) => r.json()).then((l: ListInfo[]) => {
    const all = Array.isArray(l) ? l : [];
    setLists(all);
    setList(all.find((x) => x.id === id) ?? null);
  }).catch(() => {}), [id]);
  const loadResearch = useCallback(() => fetch(`/api/lists/${id}/research`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setResearch(d); }).catch(() => {}), [id]);
  useEffect(() => { if (id) { void loadLists(); void loadResearch(); } }, [id, loadLists, loadResearch]);
  // Poll while a run is going.
  const running = research?.run?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void loadResearch(), 4000);
    return () => clearInterval(t);
  }, [running, loadResearch]);
  useEffect(() => { const t = setTimeout(() => c.search(qText), 250); return () => clearTimeout(t); }, [qText, c.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const { load } = c;
  const refresh = useCallback(() => { void load(); void loadLists(); }, [load, loadLists]);
  const toggle = useCallback((x: string) => setSelected((s) => { const n = new Set(s); if (n.has(x)) n.delete(x); else n.add(x); return n; }), []);
  const toggleAll = useCallback((on: boolean) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set()), [rows]);

  const decide = useCallback(async (tid: string, d: "approve" | "reject") => {
    const row = rows.find((r) => r.id === tid);
    try {
      if (d === "approve" && row?.agent_status === "qualified") await call(`/api/leads/${tid}`, "PATCH", { action: "enroll" });
      else if (row?.agent_status === "drafted") await call(`/api/copilot/${tid}`, "POST", { decision: d });
      else await call(`/api/leads/${tid}`, "PATCH", { action: "skip", reason: "Rejected in list" });
      toast.success(d === "approve" ? "Approved" : "Rejected");
      void load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not update the contact"); }
  }, [rows, load]);

  const removeFromList = useCallback(async (ids: string[]) => {
    setBusy(true);
    try {
      await call(`/api/lists/${id}/remove-members`, "POST", { contact_ids: ids, dry_run: false });
      toast.success(`Removed ${ids.length} contact${ids.length === 1 ? "" : "s"} from this list`);
      setSelected(new Set()); refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not remove"); }
    finally { setBusy(false); }
  }, [id, refresh]);

  async function move(to: ListInfo) {
    setBusy(true);
    try {
      await call(`/api/lists/${id}/move-targets`, "POST", { target_ids: sel, destination_list_id: to.id });
      toast.success(`Moved ${sel.length} contact${sel.length === 1 ? "" : "s"} to "${to.name}"`);
      setSelected(new Set()); refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not move"); }
    finally { setBusy(false); }
  }

  async function rename() {
    const n = name.trim();
    setEditing(false);
    if (!n || n === list?.name) return;
    try { await call(`/api/lists/${id}`, "PUT", { name: n }); setList((l) => l && { ...l, name: n }); toast.success("List renamed"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Could not rename"); }
  }

  const run = research?.run;
  const status = !run ? "This list has never been deep researched"
    : run.status === "running" ? `Researching… ${run.done_count} of ${run.total} companies checked`
    : run.status === "failed" ? `Last run failed: ${run.error ?? "unknown error"}`
    : `Last researched ${fmtDate(run.finished_at ?? run.started_at)} · ${run.criteria.join(" · ")}`;

  return (
    <>
      <Head><title>{list?.name ?? "List"} — Linki</title></Head>
      <div className="-mt-2 mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
        <div className="min-w-0">
          <Link href="/lists" className="mb-1 inline-flex items-center gap-1 text-[14px] text-base-content/55 hover:text-base-content"><RiArrowLeftSLine size={16} /> Lists</Link>
          {editing ? (
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} maxLength={120} aria-label="List name"
              onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setEditing(false); }}
              className="block h-10 w-[min(520px,80vw)] rounded-[8px] border border-primary/50 bg-base-100 px-3 text-[24px] font-medium outline-none ring-2 ring-[var(--ring)]" />
          ) : (
            <div className="flex items-center gap-2">
              <div role="heading" aria-level={1} className="truncate text-[24px] font-medium">{list?.name ?? "…"}</div>
              <button type="button" onClick={() => { setName(list?.name ?? ""); setEditing(true); }} aria-label="Rename list" className="text-base-content/50 hover:text-base-content"><RiPencilLine size={20} /></button>
            </div>
          )}
          <div className="mt-0.5 text-[16px] text-base-content/60">{(list?.target_count ?? c.total).toLocaleString()} contacts in this list</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {sel.length > 0 && (
            <>
              <button type="button" disabled={busy} onClick={() => void removeFromList(sel)} className="wizard-rise inline-flex h-11 items-center gap-2 rounded-[8px] bg-error px-4 text-[15px] font-medium text-white hover:opacity-90">
                <RiDeleteBin6Line size={18} /> Remove ({sel.length})
              </button>
              <MoveMenu lists={lists} currentId={id} disabled={busy} onMove={(l) => void move(l)} />
            </>
          )}
          <button type="button" disabled={!sel.length} onClick={() => csv(rows.filter((r) => selected.has(r.id)), research?.results ?? {}, `${list?.name ?? "list"}.csv`)}
            className="inline-flex h-11 items-center gap-2 rounded-[8px] border border-[var(--border-subtle)] px-4 text-[15px] hover:bg-base-200 disabled:text-base-content/40 disabled:hover:bg-transparent">
            <RiDownload2Line size={18} /> Export ({sel.length})
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:-mb-10 lg:h-[calc(100vh-190px)] lg:min-h-[520px]">
        <div className="flex flex-wrap items-center gap-4 rounded-[14px] border border-[var(--border-subtle)] bg-base-100 px-5 py-3.5">
          <span className="flex items-center gap-1.5 text-[15px] font-medium uppercase text-primary"><RiSearchLine size={17} /> Deep research</span>
          <span className="min-w-0 flex-1 truncate text-[15px] text-base-content/60">{status}</span>
          {running && <span className="h-1.5 w-40 overflow-hidden rounded-full bg-base-200"><span className="block h-full bg-primary transition-all duration-500" style={{ width: `${run!.total ? Math.round((run!.done_count / run!.total) * 100) : 0}%` }} /></span>}
          <button type="button" disabled={running} onClick={() => setResearchOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-primary px-4 text-[15px] font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:opacity-60">
            {running ? <RiLoader4Line size={17} className="animate-spin" /> : <RiSearchLine size={17} />} {run ? "Research again" : "Deep research this list"}
          </button>
        </div>

        <div className="relative w-full sm:w-[560px]">
          <RiSearchLine size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base-content/45" />
          <input value={qText} onChange={(e) => setQText(e.target.value)} placeholder="Search by name, email, company or job title" aria-label="Search this list"
            className="h-11 w-full rounded-[8px] border border-[var(--border-subtle)] bg-base-100 pl-10 pr-3 text-[15px] outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--ring)]" />
        </div>

        <section className="flex min-h-[400px] flex-1 flex-col overflow-hidden rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
          {c.rows === null ? <div className="flex flex-1 items-center justify-center"><RiLoader4Line size={28} className="animate-spin text-primary" /></div>
            : rows.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                <div className="text-[18px]">{c.q ? "No contacts match your search" : "This list is empty"}</div>
                <div className="text-[15px] text-base-content/55">{c.q ? "Try another name or company." : <>Add contacts from <Link href="/contacts" className="text-[#4f46e5] hover:underline">All contacts</Link> with Add to list.</>}</div>
              </div>
            ) : (
              <ContactsTable rows={rows} selected={selected} toggle={toggle} toggleAll={toggleAll} onOpen={setDrawer} onDecide={decide}
                onRemove={(tid) => void removeFromList([tid])} onDelete={(tid) => setConfirm({ ids: [tid] })} onChanged={() => void load()}
                research={research?.results ?? {}} hidden={["list"]} sizesKey="linki.list.columns.v1" />
            )}
          <Pagination page={c.page} pageSize={c.pageSize} total={c.total} setPage={(p) => { c.setPage(p); setSelected(new Set()); }} setPageSize={c.setPageSize} />
        </section>
      </div>

      <LeadDrawer targetId={drawer} onClose={() => setDrawer(null)} onChanged={() => void load()} siblings={rows.map((r) => r.id)} onOpen={setDrawer} />
      {researchOpen && list && (
        <DeepResearchDrawer listId={id} listName={list.name} leads={list.target_count} companies={research?.companies ?? 0}
          onClose={() => setResearchOpen(false)} onStarted={() => void loadResearch()} />
      )}
      {confirm && (
        <Confirm title="Delete Contacts" action="Delete" text="Are you sure you want to delete this contact? This action cannot be undone!"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            try { await call("/api/targets", "DELETE", { target_ids: confirm.ids }); toast.success("Contact deleted"); setConfirm(null); refresh(); }
            catch (err) { toast.error(err instanceof Error ? err.message : "Could not delete"); }
          }} />
      )}
    </>
  );
}
