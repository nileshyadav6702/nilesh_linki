import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  RiAddCircleLine, RiArrowDownSLine, RiDeleteBin6Line, RiDownload2Line, RiFilter3Line, RiListUnordered, RiLoader4Line,
  RiMailLine, RiPhoneLine, RiPlugLine, RiSearchLine, RiUpload2Line,
} from "react-icons/ri";
import LeadDrawer from "@/components/agents/LeadDrawer";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { Modal } from "@/components/agents/sources/kit";
import Confirm from "@/components/contacts/Confirm";
import ContactsTable from "@/components/contacts/ContactsTable";
import FiltersPanel from "@/components/contacts/FiltersPanel";
import Pagination from "@/components/contacts/Pagination";
import { activeCount, contactParams, useContacts, type ContactFilters, type ContactRow } from "@/components/contacts/useContacts";
import { failToast } from "@/components/settings/billing/credits-toast";

interface ListRow { id: string; name: string; target_count: number }

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `Request failed (${r.status})`);
  return d;
}

function csv(rows: ContactRow[], name: string) {
  const cols: Array<[string, (r: ContactRow) => unknown]> = [
    ["name", (r) => r.full_name], ["title", (r) => r.title ?? r.headline], ["company", (r) => r.company], ["email", (r) => r.email], ["phone", (r) => r.phone],
    ["linkedin", (r) => r.linkedin_url], ["score", (r) => r.lead_score ?? r.intent_score], ["list", (r) => r.list_name], ["agent", (r) => r.agent_name], ["status", (r) => r.agent_status], ["imported", (r) => r.created_at],
  ];
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const text = [cols.map(([c]) => c).join(","), ...rows.map((r) => cols.map(([, f]) => cell(f(r))).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

/** Toolbar dropdown: a button and a floating panel of items. */
function Dropdown({ label, icon, disabled, children, width = 280 }: { label: ReactNode; icon: ReactNode; disabled?: boolean; children: (close: () => void) => ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  return (
    <div ref={wrap} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open}
        className={`inline-flex h-11 items-center gap-2 rounded-[8px] border bg-base-100 px-4 text-[15px] transition-colors disabled:cursor-not-allowed disabled:text-base-content/40 ${open ? "border-base-content/70" : "border-[var(--border-subtle)] enabled:hover:bg-base-200"}`}>
        {icon}{label}<RiArrowDownSLine size={18} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div style={{ width }} className="wizard-rise absolute right-0 top-full z-40 mt-2 max-h-[420px] overflow-y-auto rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1 shadow-[var(--shadow-overlay)]">{children(() => setOpen(false))}</div>}
    </div>
  );
}

const Item = ({ icon, children, onClick, danger, disabled }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) => (
  <button type="button" onClick={onClick} disabled={disabled}
    className={`flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left text-[15px] disabled:cursor-not-allowed disabled:opacity-45 ${danger ? "text-error hover:bg-error/10" : "hover:bg-base-200"}`}>
    {icon}<span className="min-w-0 flex-1">{children}</span>
  </button>
);

/**
 * The contacts grid with its toolbar, filters, bulk actions, pagination and lead drawer.
 * Used by All contacts (everything) and an agent's Leads tab (base filter on the agent).
 */
export function ContactsWorkspace({ base, hidden, sizesKey, openLeadId, className = "lg:-mb-10 lg:h-[calc(100vh-200px)] lg:min-h-[520px]" }: {
  base?: Partial<ContactFilters>; hidden?: string[]; sizesKey?: string; openLeadId?: string; className?: string;
}) {
  const c = useContacts(base);
  const [qText, setQText] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<string | null>(openLeadId ?? null);
  // Open the drawer when the parent asks for another lead (?lead= on the agent page).
  const [prevOpen, setPrevOpen] = useState(openLeadId);
  if (openLeadId !== prevOpen) { setPrevOpen(openLeadId); if (openLeadId) setDrawer(openLeadId); }
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [lists, setLists] = useState<ListRow[]>([]);
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null);
  const [newList, setNewList] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => c.rows ?? [], [c.rows]);
  const sel = [...selected];

  const loadLists = useCallback(() => { fetch("/api/lists").then((r) => r.json()).then((l) => setLists(Array.isArray(l) ? l : [])).catch(() => {}); }, []);
  useEffect(() => {
    loadLists();
    fetch("/api/agents").then((r) => r.json()).then((a) => setAgents((Array.isArray(a) ? a : []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })))).catch(() => {});
  }, [loadLists]);
  useEffect(() => { const t = setTimeout(() => c.search(qText), 250); return () => clearTimeout(t); }, [qText, c.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const { load } = c;
  const refresh = useCallback(() => { void load(); loadLists(); }, [load, loadLists]);
  const toggle = useCallback((id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const toggleAll = useCallback((on: boolean) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set()), [rows]);

  const decide = useCallback(async (id: string, d: "approve" | "reject") => {
    const row = rows.find((r) => r.id === id);
    try {
      if (d === "approve" && row?.agent_status === "qualified") await call(`/api/leads/${id}`, "PATCH", { action: "enroll" });
      else if (row?.agent_status === "drafted") await call(`/api/copilot/${id}`, "POST", { decision: d, reason: d === "reject" ? "Rejected in Contacts" : undefined });
      else await call(`/api/leads/${id}`, "PATCH", { action: "skip", reason: "Rejected in Contacts" });
      toast.success(d === "approve" ? "Approved" : "Rejected");
      void load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not update the contact"); }
  }, [rows, load]);

  const remove = useCallback(async (id: string) => {
    const row = rows.find((r) => r.id === id);
    try {
      if (row?.agent_id) await call(`/api/leads/${id}`, "PATCH", { action: "remove" });
      else if (c.filters.list && c.filters.list !== "none") await call(`/api/lists/${c.filters.list}/remove-members`, "POST", { contact_ids: [id], dry_run: false });
      else throw new Error("Filter by a list first to remove this contact from it");
      toast.success("Removed from list and campaign");
      refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not remove the contact"); }
  }, [rows, c.filters.list, refresh]);

  async function addToList(listId: string, name: string) {
    setBusy(true);
    try {
      await call(`/api/lists/${listId}/add-members`, "POST", { contact_ids: sel });
      toast.success(`Added ${sel.length} contact${sel.length === 1 ? "" : "s"} to "${name}"`);
      refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not add to the list"); }
    finally { setBusy(false); }
  }

  async function removeFromList() {
    const listId = c.filters.list;
    if (!listId || listId === "none") return toast.error("Filter by a list first, then remove the selected contacts from it");
    setBusy(true);
    try {
      await call(`/api/lists/${listId}/remove-members`, "POST", { contact_ids: sel, dry_run: false });
      toast.success(`Removed ${sel.length} from the list`);
      setSelected(new Set()); refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not remove from the list"); }
    finally { setBusy(false); }
  }

  async function exportAll() {
    setBusy(true);
    try {
      const all: ContactRow[] = [];
      for (let off = 0; off < Math.min(c.total, 10_000); off += 100) {
        const d = await call(`/api/leads?${contactParams(c.filters, c.q, { limit: "100", offset: String(off) })}`, "GET");
        all.push(...(d.leads as ContactRow[]));
      }
      csv(all, "contacts.csv");
      toast.success(`Exported ${all.length} contacts`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Export failed"); }
    finally { setBusy(false); }
  }

  async function enrichEmails() {
    setBusy(true);
    let found = 0;
    for (const id of sel) {
      const r = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "find_email" }) }).catch(() => null);
      const d = r ? await r.json().catch(() => ({})) : {};
      // Out of credits: stop here instead of failing every remaining contact.
      if (r?.status === 402) { setBusy(false); failToast(d, "Not enough credits"); void c.load(); return; }
      if (r?.ok && d.found) found++;
    }
    setBusy(false);
    toast.success(`Found ${found} email${found === 1 ? "" : "s"} for ${sel.length} contact${sel.length === 1 ? "" : "s"}`);
    void c.load();
  }

  // Filters fixed by the page (e.g. the agent) don't count as the user's own.
  const filterCount = activeCount(c.filters) - Object.values(base ?? {}).filter(Boolean).length;

  return (
    <>
      <div className={`flex flex-col gap-4 ${className}`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-[340px]">
            <RiSearchLine size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base-content/45" />
            <input value={qText} onChange={(e) => setQText(e.target.value)} placeholder="Search by name, email, company, location" aria-label="Search contacts"
              className="h-11 w-full rounded-[8px] border border-[var(--border-subtle)] bg-base-100 pl-10 pr-3 text-[15px] outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--ring)]" />
          </div>
          <div className="relative">
            <button type="button" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}
              className={`inline-flex h-11 items-center gap-2 rounded-[8px] border px-4 text-[15px] font-medium transition-colors ${filterCount ? "border-primary/60 bg-primary/5 text-primary" : filtersOpen ? "border-base-content/70 bg-base-100" : "border-[var(--border-subtle)] bg-base-100 hover:bg-base-200"}`}>
              <RiFilter3Line size={18} /> Add more filters
              {filterCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[12px] text-primary-content">{filterCount}</span>}
              <RiArrowDownSLine size={18} className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
            </button>
            {filtersOpen && <FiltersPanel filters={c.filters} patch={c.patch} clear={c.clear} onClose={() => setFiltersOpen(false)} agents={agents} lists={lists} signals={c.signals} lockAgent={!!base?.agent} />}
          </div>
          {filterCount > 0 && <button type="button" onClick={c.clear} className="text-[15px] text-base-content/75 hover:text-base-content hover:underline">Clear all</button>}

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <Dropdown label="Add to list" icon={<RiListUnordered size={18} />} disabled={!sel.length || busy} width={300}>
              {(close) => (
                <>
                  {lists.map((l) => <Item key={l.id} icon={<RiListUnordered size={18} className="text-base-content/60" />} onClick={() => { close(); void addToList(l.id, l.name); }}>{l.name}</Item>)}
                  <div className="my-1 border-t border-[var(--border-subtle)]" />
                  <Item icon={<RiAddCircleLine size={18} />} onClick={() => { close(); setNewList(true); }}>Create new list</Item>
                  <Item icon={<RiDeleteBin6Line size={18} />} danger onClick={() => { close(); void removeFromList(); }}>Remove from list</Item>
                </>
              )}
            </Dropdown>
            <Dropdown label="Export to..." icon={<RiUpload2Line size={18} />} disabled={busy}>
              {(close) => (
                <>
                  <Item icon={<RiDownload2Line size={18} />} disabled={!sel.length} onClick={() => { close(); csv(rows.filter((r) => selected.has(r.id)), "contacts-selected.csv"); }}>Export Selected ({sel.length})</Item>
                  <Item icon={<RiDownload2Line size={18} />} onClick={() => { close(); void exportAll(); }}>Export all ({c.total.toLocaleString()})</Item>
                  <Link href="/settings?tab=integrations" className="flex items-center gap-3 rounded-[8px] px-3 py-2.5 text-[15px] hover:bg-base-200"><RiPlugLine size={18} /> Add an integration</Link>
                </>
              )}
            </Dropdown>
            <Dropdown label="Enrich" icon={<RiSearchLine size={18} />} disabled={!sel.length || busy} width={240}>
              {(close) => (
                <>
                  <Item icon={<RiMailLine size={18} />} onClick={() => { close(); void enrichEmails(); }}>Enrich Email</Item>
                  <Item icon={<RiPhoneLine size={18} />} onClick={() => { close(); toast.message("Phone enrichment is coming soon"); }}>Enrich Phone <span className="ml-1 rounded-full bg-base-200 px-2 py-0.5 text-[12px] text-base-content/55">Soon</span></Item>
                </>
              )}
            </Dropdown>
            {sel.length > 0 && (
              <button type="button" disabled={busy} onClick={() => setConfirm({ ids: sel })}
                className="wizard-rise inline-flex h-11 items-center gap-2 rounded-[8px] border border-error/40 bg-error/5 px-4 text-[15px] text-error hover:bg-error/10">
                <RiDeleteBin6Line size={18} /> Delete ({sel.length})
              </button>
            )}
            {busy && <RiLoader4Line size={20} className="animate-spin text-primary" aria-label="Working" />}
          </div>
        </div>

        <section className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
          {c.rows === null ? <div className="flex flex-1 items-center justify-center"><RiLoader4Line size={28} className="animate-spin text-primary" /></div>
            : rows.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                <div className="text-[18px]">{c.error ?? (filterCount || c.q ? "No contacts match these filters" : "No contacts yet")}</div>
                <div className="text-[15px] text-base-content/55">{filterCount || c.q ? "Try clearing a filter or the search." : "Import a list or create an agent to find leads."}</div>
                {(filterCount > 0 || c.q) && <button type="button" onClick={() => { c.clear(); setQText(""); }} className="mt-2 text-[15px] text-[#4f46e5] hover:underline">Clear all filters</button>}
              </div>
            ) : (
              <ContactsTable rows={rows} selected={selected} toggle={toggle} toggleAll={toggleAll} onOpen={setDrawer} onDecide={decide}
                onRemove={(id) => void remove(id)} onDelete={(id) => setConfirm({ ids: [id] })} onChanged={() => void c.load()}
                hidden={hidden} sizesKey={sizesKey} />
            )}
          <Pagination page={c.page} pageSize={c.pageSize} total={c.total} setPage={(p) => { c.setPage(p); setSelected(new Set()); }} setPageSize={c.setPageSize} />
        </section>
      </div>

      <LeadDrawer targetId={drawer} onClose={() => setDrawer(null)} onChanged={() => void c.load()} siblings={rows.map((r) => r.id)} onOpen={setDrawer} />

      {confirm && (
        <Confirm title="Delete Contacts" action="Delete"
          text={`Are you sure you want to delete ${confirm.ids.length === 1 ? "this contact" : `${confirm.ids.length} selected contacts`}? This action cannot be undone!`}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              const d = await call("/api/targets", "DELETE", { target_ids: confirm.ids });
              toast.success(`Deleted ${d.deleted ?? confirm.ids.length} contact${(d.deleted ?? confirm.ids.length) === 1 ? "" : "s"}`);
              setSelected(new Set()); setConfirm(null); refresh();
            } catch (err) { toast.error(err instanceof Error ? err.message : "Could not delete"); }
          }} />
      )}

      {newList && <NewListDialog onClose={() => setNewList(false)} onCreated={(l) => { setNewList(false); void addToList(l.id, l.name); }} />}
    </>
  );
}

function NewListDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (l: { id: string; name: string }) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  async function create() {
    setSaving(true);
    try { const d = await call("/api/lists", "POST", { name: name.trim() }); onCreated({ id: d.id, name: d.name }); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Could not create the list"); setSaving(false); }
  }
  return (
    <Modal labelId="contacts-new-list" title="Create a new List" subtitle="The selected contacts are added to it." wide={false} onClose={() => !saving && onClose()}
      footer={<>
        <button type="button" onClick={onClose} disabled={saving} className="h-10 rounded-[8px] px-4 text-sm font-medium text-base-content/75 hover:bg-base-200">Cancel</button>
        <button type="button" onClick={() => void create()} disabled={saving || !name.trim()} className="h-10 rounded-[8px] bg-primary px-4 text-sm font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:bg-base-200 disabled:text-base-content/35">{saving ? "Creating…" : "Create list"}</button>
      </>}>
      <form className="space-y-2 px-6 py-6" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create(); }}>
        <label htmlFor="contacts-new-list-name" className="text-[15px] font-medium">List Name <span className="text-error">*</span></label>
        <input id="contacts-new-list-name" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter a name for your list"
          className="h-12 w-full rounded-[8px] border border-[var(--border-strong)] bg-base-100 px-4 text-[15px] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--ring)]" />
      </form>
    </Modal>
  );
}
