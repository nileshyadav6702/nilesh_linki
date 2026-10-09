import Head from "next/head";
import { useState, useEffect, useRef } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import ContactsHeader from "@/components/contacts/ContactsHeader";
import { getDb } from "@/lib/db";
import { getServerWorkspace, loginRedirect } from "@/lib/server-workspace";
import { toast } from "sonner";
import Link from "next/link";
import { RiAddLine, RiDeleteBinLine, RiCloseLine, RiCalendarLine, RiListUnordered, RiUser3Line } from "react-icons/ri";
import Confirm from "@/components/contacts/Confirm";

interface List {
  id: string;
  name: string;
  description: string | null;
  target_count: number;
  created_at: string;
  active_run_id: string | null;
  active_run_status: string | null;
  active_workflow_name: string | null;
  active_imports: number;
  pending_verification: number;
  status: "importing" | "verifying" | "ready" | "empty";
  last_researched_at: string | null;
}

interface ImportJob {
  id: string;
  list_id: string;
  list_name?: string;
  status: string;
  phase: string | null;
  page: number;
  total_pages: number;
  count: number;
  total: number;
  imported: number;
  scheduled_for: string | null;
  start_page: number;
  batch_index: number;
  started_at: string;
  finished_at: string | null;
}

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const db = getDb();
  const workspace = await getServerWorkspace(req, res);
  if (!workspace) return loginRedirect(req);
  const { workspaceId } = workspace;
  const rows = db
    .prepare(
      `SELECT l.*,
              (SELECT COUNT(*) FROM list_targets lt WHERE lt.list_id = l.id) as target_count,
              ar.id as active_run_id,
              ar.status as active_run_status,
              w.name as active_workflow_name,
              (SELECT COUNT(*) FROM list_imports li WHERE li.list_id = l.id AND li.status NOT IN ('completed','failed','cancelled','canceled')) as active_imports,
          (SELECT MAX(finished_at) FROM list_research lr WHERE lr.list_id = l.id AND lr.status = 'done') as last_researched_at,
              (SELECT COUNT(*) FROM list_targets lt2 JOIN targets t ON t.id = lt2.target_id
                 WHERE lt2.list_id = l.id AND t.email_verify_requested_at IS NOT NULL) as pending_verification
       FROM lists l
       LEFT JOIN runs ar ON ar.id = (
         SELECT r2.id FROM runs r2
         WHERE r2.list_id = l.id AND r2.status IN ('running', 'paused')
         ORDER BY CASE r2.status WHEN 'running' THEN 0 ELSE 1 END, r2.created_at DESC
         LIMIT 1
       )
       LEFT JOIN workflows w ON w.id = ar.workflow_id
       WHERE l.workspace_id = ?
       ORDER BY l.created_at DESC`
    )
    .all(workspaceId) as Array<Record<string, unknown> & { target_count: number; active_imports: number; pending_verification: number }>;
  const lists = rows.map((l) => ({
    ...l,
    status: l.active_imports > 0 ? "importing"
      : l.pending_verification > 0 ? "verifying"
      : l.target_count > 0 ? "ready"
      : "empty",
  }));
  return { props: { initialLists: lists } };
};

export default function ListsPage({ initialLists }: { initialLists: List[] }) {
  const router = useRouter();
  const [lists, setLists] = useState<List[]>(initialLists);
  // "Add leads → Import into a list" on the Contacts page lands here with ?new=1.
  const [showModal, setShowModal] = useState(() => router.query.new === "1");
  const [form, setForm] = useState({ name: "", description: "" });
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<List | null>(null);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [dailyCap, setDailyCap] = useState(1500);
  const [importedToday, setImportedToday] = useState(0);
  const prevRunningRef = useRef(0);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch("/api/imports");
        const data = await r.json();
        if (!alive) return;
        setJobs(data.jobs ?? []);
        setDailyCap(data.dailyCap ?? 1500);
        setImportedToday(data.importedToday ?? 0);
        // A batch just finished → refresh list counts
        const running = (data.jobs ?? []).filter((j: ImportJob) => j.status === "running").length;
        if (running < prevRunningRef.current) {
          fetch("/api/lists").then((lr) => lr.json()).then((d) => { if (alive) setLists(d); }).catch(() => {});
        }
        prevRunningRef.current = running;
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  async function cancelImport(id: string) {
    if (!confirm("Cancel this import? A running batch stops at its next page.")) return;
    await fetch(`/api/imports/${id}/cancel`, { method: "POST" });
    toast.success("Import canceled");
  }

  const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "scheduled");
  const runningByList: Record<string, ImportJob> = {};
  for (const j of jobs) if (j.status === "running") runningByList[j.list_id] = j;

  async function refresh() {
    const res = await fetch("/api/lists");
    setLists(await res.json());
  }

  async function createList(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) { toast.error("Failed to create list"); return; }
    toast.success("List created");
    setShowModal(false);
    setForm({ name: "", description: "" });
    refresh();
  }

  async function deleteList(id: string) {
    await fetch(`/api/lists/${id}`, { method: "DELETE" });
    toast.success("List deleted");
    setLists((prev) => prev.filter((l) => l.id !== id));
  }

  return (
    <>
    <Head>
      <title>Lists — Kairo</title>
      <meta name="description" content="Lead lists imported from LinkedIn Sales Navigator." />
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div className="space-y-6">
      <ContactsHeader tab="lists" action={
        <button
          data-tour="lists-new"
          className="inline-flex items-center gap-1.5 h-11 px-4 rounded-[10px] text-[15px] font-medium bg-primary text-primary-content hover:bg-[var(--primary-hover)] transition-colors shrink-0 shadow-[0_4px_12px_-4px_rgba(204,120,92,0.6)]"
          onClick={() => setShowModal(true)}
        >
          <RiAddLine size={16} /> New List
        </button>
      } />

      {/* Import jobs panel */}
      {activeJobs.length > 0 && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-base-100 p-5 shadow-[var(--shadow-raised)]" data-tour="lists-jobs">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Import jobs</h2>
            <span className="text-xs text-base-content/50 tabular-nums">
              {importedToday} / {dailyCap} contacts imported today
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {activeJobs.map((j) => {
              const pct = j.total > 0 ? Math.round((j.count / j.total) * 100) : 0;
              const scheduled = j.status === "scheduled";
              return (
                <div key={j.id} className="flex items-center gap-3 rounded-[10px] border border-[var(--border-subtle)] bg-base-200 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{j.list_name ?? "—"}</span>
                      {j.batch_index > 1 && (
                        <span className="text-xs text-base-content/40">batch {j.batch_index}</span>
                      )}
                      {scheduled ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning">
                          <RiCalendarLine size={11} /> Scheduled {j.scheduled_for}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-[var(--border-strong)] text-base-content/70">
                          <span className="loading loading-spinner" style={{ width: 9, height: 9 }} /> Scraping {pct}%
                        </span>
                      )}
                    </div>
                    {!scheduled && (
                      <div className="mt-1.5 w-full bg-base-100 rounded-full h-1 overflow-hidden">
                        <div className="bg-primary h-1 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    <span className="text-xs text-base-content/40">
                      {scheduled
                        ? `Resumes at page ${j.start_page} — capped at ${dailyCap}/day`
                        : `${j.count} / ${j.total} this batch`}
                    </span>
                  </div>
                  <button
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] text-xs font-medium bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors shrink-0"
                    onClick={() => cancelImport(j.id)}
                  >
                    <RiCloseLine size={12} /> Cancel
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lists.length === 0 ? (
        <div className="rounded-[16px] border border-[var(--border-subtle)] bg-base-100 py-16 text-center text-[15px] text-base-content/50">
          No lists yet. Create one and import leads into it.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
          <div className="max-h-[calc(100vh-230px)] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-left">
              <thead className="sticky top-0 z-10">
                <tr className="text-[14px] font-medium uppercase tracking-[0.04em] text-base-content/70">
                  {["List name", "Contacts", "Last deep research", "Created", "Actions"].map((h, i) => (
                    <th key={h} className={`border-b border-[var(--border-subtle)] bg-base-200 py-4 font-medium ${i === 0 ? "pl-7" : "px-4"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lists.map((l) => {
                  const job = runningByList[l.id];
                  const pct = job && job.total > 0 ? Math.round((job.count / job.total) * 100) : 0;
                  return (
                    <tr key={l.id} className="group cursor-pointer" onClick={() => router.push(`/lists/${l.id}`)}>
                      <td className="border-b border-[var(--border-subtle)] py-4 pl-7 pr-4 transition-colors group-hover:bg-base-200/60">
                        <div className="flex min-w-0 items-center gap-4">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary"><RiListUnordered size={20} /></span>
                          <div className="min-w-0">
                            <div className="truncate text-[17px] text-base-content">{l.name}</div>
                            {job ? (
                              <div className="mt-1 flex items-center gap-2 text-[13px] text-primary"><span className="loading loading-spinner loading-xs" style={{ width: 10, height: 10 }} /> Importing {pct}% · {job.count}/{job.total}</div>
                            ) : l.status === "verifying" ? (
                              <div className="mt-1 text-[13px] text-[#b8742a]">Verifying emails…</div>
                            ) : l.description ? <div className="mt-0.5 truncate text-[13px] text-base-content/45">{l.description}</div> : null}
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-[var(--border-subtle)] px-4 py-4 transition-colors group-hover:bg-base-200/60">
                        <span className="inline-flex items-center gap-2.5 text-[17px] tabular-nums"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ece9fb] text-[#5b4fd6]"><RiUser3Line size={16} /></span>{l.target_count.toLocaleString()}</span>
                      </td>
                      <td className="border-b border-[var(--border-subtle)] px-4 py-4 transition-colors group-hover:bg-base-200/60">
                        {l.last_researched_at
                          ? <span className="inline-flex items-center gap-2 text-[16px] text-base-content/80"><span className="h-1.5 w-1.5 rounded-full bg-success" />{new Date(`${l.last_researched_at.replace(" ", "T")}Z`).toLocaleDateString()}</span>
                          : <span className="inline-flex items-center gap-2 text-[16px] text-base-content/45"><span className="h-1.5 w-1.5 rounded-full bg-base-content/25" />Never researched</span>}
                      </td>
                      <td className="border-b border-[var(--border-subtle)] px-4 py-4 transition-colors group-hover:bg-base-200/60">
                        <span className="inline-flex items-center gap-2.5 text-[16px] text-base-content/80"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-success/15 text-[#2f7a43]"><RiCalendarLine size={16} /></span>{new Date(l.created_at).toLocaleDateString()}</span>
                      </td>
                      <td className="border-b border-[var(--border-subtle)] px-4 py-4 transition-colors group-hover:bg-base-200/60" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-3">
                          <Link href={`/lists/${l.id}`} className="inline-flex h-9 items-center rounded-[8px] bg-primary/10 px-4 text-[15px] text-primary transition-colors hover:bg-primary/20">View</Link>
                          <button type="button" onClick={() => setDeleting(l)} aria-label={`Delete ${l.name}`} className="flex h-9 w-9 items-center justify-center rounded-[8px] text-base-content/45 transition-colors hover:bg-error/10 hover:text-error"><RiDeleteBinLine size={19} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {deleting && (
        <Confirm title="Delete List" action="Delete"
          text={<>Are you sure you want to delete <b className="font-medium text-base-content">{deleting.name}</b>? <b className="font-medium text-base-content">Its contacts stay in All contacts</b>; only the list (and any campaign runs on it) is removed.</>}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => { await deleteList(deleting.id); setDeleting(null); }} />
      )}

      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-100 border border-[var(--border-subtle)] rounded-2xl shadow-[var(--shadow-modal)] max-w-md">
            <h3 className="font-semibold text-lg mb-4">New List</h3>
            <form onSubmit={createList} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">List name</label>
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder="e.g. Q1 SaaS Founders"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Description (optional)</label>
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder="e.g. Founders from Sales Nav search"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="modal-action mt-2">
                <button type="button" className="inline-flex items-center px-4 h-9 rounded-[10px] text-sm font-medium border border-[var(--border)] bg-base-100 text-base-content/70 hover:bg-base-200 transition-colors" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 h-9 rounded-[10px] text-sm font-semibold bg-primary text-primary-content hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50" disabled={loading}>
                  {loading ? <span className="loading loading-spinner loading-xs" /> : "Create"}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={() => setShowModal(false)} />
        </div>
      )}
    </div>
    </>
  );
}
