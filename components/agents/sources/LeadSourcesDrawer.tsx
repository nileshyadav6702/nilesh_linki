import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RiArrowDownSLine, RiArrowRightSLine, RiCloseLine, RiExternalLinkLine, RiLoader4Line } from "react-icons/ri";
import { primaryBtn } from "@/components/agents/ui";
import { SoonPill, useDialog } from "@/components/agents/sources/kit";
import { changedTypes, draftsFromRows, IMPORT_ITEMS, itemSignals, LIVE_ITEMS, totalSignals, type Drafts, type ItemDef, type ItemId } from "@/components/agents/sources/catalog";
import { CompetitorPanel, ExpertsPanel, TopicPanel } from "@/components/agents/sources/SignalPanels";
import { BuyingEventsPanel, EngagingPanel, LookalikePanel, TechStackPanel, WebsitePanel } from "@/components/agents/sources/CheckPanels";
import SavedListPanel, { type ListRow } from "@/components/agents/sources/SavedListPanel";
import CsvImportModal from "@/components/agents/sources/CsvImportModal";
import LinkedInImportModal from "@/components/agents/sources/LinkedInImportModal";
import { SIGNAL_BUDGET, type DrawerSignalType, type SignalDraft } from "@/lib/agents/lead-source-rules";
import type { Icp } from "@/lib/icp/schema";

export interface DrawerSourceRow { id: string; source_type: string; config_json: string; enabled: number }

/** Problems that would make a staged source useless (or the save fail), shown before saving. */
function problems(d: Drafts, icpQuery: string): string[] {
  const out: string[] = [];
  if (d.own_content_engagement.enabled && !d.own_content_engagement.config.urls?.length) out.push("People engaging with you: add your LinkedIn profile or company page.");
  if (d.hiring.enabled && !d.hiring.config.boards?.length) out.push("Job openings: add at least one job board.");
  const q = (d.lookalike.config.keywords?.[0] ?? "").trim();
  if (d.lookalike.enabled && (q ? q.length < 2 : !icpQuery)) out.push("Lookalike: add a Sales Navigator keyword query.");
  if (d.hiring_surge.enabled && !d.hiring.config.boards?.length) out.push("Hiring surge: add at least one job board under Buying events.");
  if (d.company_followers.enabled && !d.company_followers.config.urls?.length) out.push("Company page followers: add your company page.");
  return out;
}

const listIdsOf = (rows: DrawerSourceRow[]): string[] => {
  try { return (JSON.parse(rows.find((r) => r.source_type === "existing_list")?.config_json || "{}").list_ids ?? []) as string[]; } catch { return []; }
};

/**
 * "Lead sources" drawer: live signals and imports for one agent. Signal and list edits are staged
 * ("N pending changes") and saved together; CSV and LinkedIn imports run immediately in their modals.
 * Mount only while open.
 */
export default function LeadSourcesDrawer({ agentId, agentName, ownListId, rows, icp, hasLinkedIn, autoEnrichEmails, onClose, onChanged, initialItem }: {
  agentId: string; agentName: string; ownListId: string | null; rows: DrawerSourceRow[]; icp: Icp; hasLinkedIn: boolean; autoEnrichEmails: boolean;
  onClose: () => void; onChanged: () => void;
  /** Item to open first ("saved_list" when arriving from Contacts → Add leads). */
  initialItem?: ItemId;
}) {
  const [initial, setInitial] = useState<Drafts>(() => draftsFromRows(rows));
  const [draft, setDraft] = useState<Drafts>(initial);
  const [attach, setAttach] = useState<string[]>([]);
  const [detach, setDetach] = useState<string[]>([]);
  const [selected, setSelected] = useState<ItemId>(initialItem ?? "competitor");
  const [liveOpen, setLiveOpen] = useState(!initialItem || LIVE_ITEMS.some((i) => i.id === initialItem));
  const [importOpen, setImportOpen] = useState(() => IMPORT_ITEMS.some((i) => i.id === initialItem));
  const [modal, setModal] = useState<"csv" | "linkedin" | null>(null);
  const [lists, setLists] = useState<ListRow[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const attached = useMemo(() => listIdsOf(rows), [rows]);
  const changed = changedTypes(initial, draft);
  const pending = changed.length + attach.length + detach.length;
  const signals = totalSignals(draft);
  const budgetLeft = SIGNAL_BUDGET - signals;
  const icpQuery = icp.sales_nav_keywords.trim();
  const issues = problems(draft, icpQuery);

  const loadLists = useCallback(async () => {
    try {
      const r = await fetch("/api/lists");
      if (r.ok) setLists(((await r.json()) as ListRow[]).map((l) => ({ id: l.id, name: l.name, target_count: l.target_count })));
    } finally { setListsLoading(false); }
  }, []);
  useEffect(() => { void loadLists(); }, [loadLists]);

  function requestClose() {
    if (saving || modal) return;
    if (pending > 0 && !confirm(`Discard ${pending} unsaved change${pending === 1 ? "" : "s"}?`)) return;
    onClose();
  }
  const { shown, onKeyDown } = useDialog(panel, requestClose);

  const set = (type: DrawerSignalType, next: SignalDraft) => setDraft((d) => ({ ...d, [type]: next }));

  async function save() {
    if (issues.length) { toast.error(issues[0]); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/agents/${agentId}/sources`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: changed.map((t) => ({ source_type: t, enabled: draft[t].enabled, config: draft[t].config })), attach_list_ids: attach, detach_list_ids: detach }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error ?? "Could not save lead sources"); return; }
      toast.success("Lead sources saved");
      setInitial(draft); setAttach([]); setDetach([]);
      onChanged();
      onClose();
    } catch {
      toast.error("Could not save lead sources");
    } finally { setSaving(false); }
  }

  /** A modal import attached a list server-side: refresh the tab and the list picker. */
  function imported() {
    void loadLists();
    onChanged();
  }

  function openItem(item: ItemDef) {
    if (item.id === "csv" || item.id === "linkedin") { setModal(item.id); return; }
    setSelected(item.id);
  }

  const panelFor = (id: ItemId) => {
    const p = { budgetLeft };
    switch (id) {
      case "competitor": return <CompetitorPanel {...p} draft={draft.competitor_engagement} onChange={(n) => set("competitor_engagement", n)} suggestions={icp.competitors} />;
      case "topic": return <TopicPanel {...p} draft={draft.keyword_engagement} onChange={(n) => set("keyword_engagement", n)} suggestions={[...icp.keywords, ...icp.mandatory_keywords]} />;
      case "experts": return <ExpertsPanel {...p} draft={draft.influencer_engagement} onChange={(n) => set("influencer_engagement", n)} />;
      case "buying": return <BuyingEventsPanel {...p} drafts={draft} set={set} hasLinkedIn={hasLinkedIn} />;
      case "engaging": return <EngagingPanel {...p} drafts={draft} set={set} hasLinkedIn={hasLinkedIn} />;
      case "lookalike": return <LookalikePanel {...p} drafts={draft} set={set} hasLinkedIn={hasLinkedIn} icpQuery={icpQuery} />;
      case "tech": return <TechStackPanel {...p} drafts={draft} set={set} hasLinkedIn={hasLinkedIn} />;
      case "website": return <WebsitePanel />;
      case "saved_list": return (
        <SavedListPanel lists={lists} loading={listsLoading} attached={attached} ownListId={ownListId} attach={attach} detach={detach}
          onAttach={(id) => { setDetach((d) => d.filter((x) => x !== id)); if (!attached.includes(id)) setAttach((a) => [...new Set([...a, id])]); }}
          onDetach={(id) => { if (attach.includes(id)) setAttach((a) => a.filter((x) => x !== id)); else setDetach((d) => [...new Set([...d, id])]); }} />
      );
      default: return null;
    }
  };

  const itemRow = (item: ItemDef) => {
    const n = itemSignals(item, draft);
    const on = selected === item.id && !item.modal;
    const listsCount = attached.filter((id) => !detach.includes(id)).length + attach.length;
    return (
      <button key={item.id} type="button" onClick={() => openItem(item)} aria-current={on ? "true" : undefined}
        className={`flex w-full items-center gap-4 rounded-[12px] border px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${on ? "border-primary/35 bg-base-100 shadow-[0_1px_2px_rgba(20,20,19,0.06)]" : "border-transparent hover:bg-base-200/60"} ${item.soon ? "opacity-70" : ""}`}>
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] [&>svg]:h-[22px] [&>svg]:w-[22px] ${item.tint}`}>{item.icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[17.5px] ${item.soon ? "text-base-content/50" : "text-base-content"}`}>{item.title}</span>
          <span className="block truncate text-[15.5px] text-base-content/50">{item.summary(draft, { lists: listsCount })}</span>
        </span>
        {item.soon ? <SoonPill />
          : item.modal ? <RiExternalLinkLine size={17} className="shrink-0 text-base-content/35" aria-label="Opens a dialog" />
          : item.id === "saved_list" ? <RiArrowRightSLine size={18} className="shrink-0 text-base-content/35" />
          : n > 0 && <span className="shrink-0 rounded-[6px] bg-base-200 px-2 py-0.5 text-[15px] text-base-content/75">{n} signal{n === 1 ? "" : "s"}</span>}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" tabIndex={-1} aria-label="Close" onClick={requestClose}
        className={`absolute inset-0 bg-[#141413]/35 transition-opacity duration-300 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="lead-sources-title" tabIndex={-1} onKeyDown={modal ? undefined : onKeyDown}
        className={`relative flex h-full w-full flex-col bg-base-100 shadow-[var(--shadow-overlay)] outline-none transition-transform duration-200 ease-out ease-out motion-reduce:transition-none md:w-[88%] md:min-w-[860px] md:max-w-[1440px] ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-6 py-5">
          <h2 id="lead-sources-title" className="flex flex-wrap items-baseline gap-3 font-medium text-[28px] leading-tight text-base-content">
            Lead sources
            <span className={`font-sans text-[18px] ${signals > SIGNAL_BUDGET ? "text-error" : "text-base-content/55"}`} title="Each tracked page, topic or switched-on event is one signal">{signals} of {SIGNAL_BUDGET} signals</span>
          </h2>
          <button type="button" onClick={requestClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-base-content/50 hover:bg-base-200 hover:text-base-content">
            <RiCloseLine size={28} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav aria-label="Lead source types" className="max-h-[42vh] shrink-0 overflow-y-auto overscroll-contain border-b border-[var(--border-subtle)] bg-base-200/35 md:max-h-none md:w-[35%] md:border-b-0 md:border-r">
            <div className="border-b border-[var(--border-subtle)] p-3">
              <button type="button" onClick={() => setLiveOpen(!liveOpen)} aria-expanded={liveOpen} className="flex w-full items-center justify-between rounded-[8px] px-2 py-2 text-left hover:bg-base-200/60">
                <span className="caps text-[15.5px] font-medium tracking-[0.08em] text-base-content/60">Live signals</span>
                <RiArrowDownSLine size={24} className={`text-base-content/45 transition-transform ${liveOpen ? "rotate-180" : ""}`} />
              </button>
              {liveOpen && <div className="mt-1 space-y-0.5">{LIVE_ITEMS.map(itemRow)}</div>}
            </div>
            <div className="p-3">
              <button type="button" onClick={() => setImportOpen(!importOpen)} aria-expanded={importOpen} className="flex w-full items-center justify-between rounded-[8px] px-2 py-2 text-left hover:bg-base-200/60">
                <span>
                  <span className="caps block text-[15.5px] font-medium tracking-[0.08em] text-base-content/60">Import from…</span>
                  <span className="block text-[15.5px] text-base-content/50">CSV, Saved lists, or LinkedIn</span>
                </span>
                <RiArrowDownSLine size={24} className={`text-base-content/45 transition-transform ${importOpen ? "rotate-180" : ""}`} />
              </button>
              {importOpen && <div className="mt-1 space-y-0.5">{IMPORT_ITEMS.map(itemRow)}</div>}
            </div>
          </nav>
          <section className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-8 sm:px-9" aria-live="polite">
            {!hasLinkedIn && ["competitor", "topic", "experts"].includes(selected) && (
              <p className="mb-5 rounded-[12px] bg-[#e8a55a]/15 px-4 py-3 text-[14.5px] text-[#8a5a1f]">This agent has no LinkedIn account yet, so LinkedIn signals will start once you add one in Settings.</p>
            )}
            {panelFor(selected)}
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-6 py-4">
          <span className={`text-[16.5px] ${issues.length && pending ? "text-error" : pending ? "text-[#e0573a]" : "text-base-content/60"}`}>
            {pending ? (issues.length ? issues[0] : `${pending} unsaved change${pending === 1 ? "" : "s"}`) : "No pending changes"}
          </span>
          <span className="flex items-center gap-3">
            {pending > 0 && !saving && (
              <button type="button" onClick={() => { setDraft(initial); setAttach([]); setDetach([]); }}
                className="px-3 text-[16.5px] font-medium text-base-content/70 hover:text-base-content">Discard</button>
            )}
            <button type="button" className={primaryBtn} disabled={!pending || saving} onClick={save}>
              {saving ? <><RiLoader4Line size={16} className="animate-spin" /> Saving…</> : "Save"}
            </button>
          </span>
        </footer>
      </div>
      {modal === "csv" && <CsvImportModal agentId={agentId} agentName={agentName} autoEnrichEmails={autoEnrichEmails} onClose={() => setModal(null)} onImported={imported} />}
      {modal === "linkedin" && <LinkedInImportModal agentId={agentId} lists={lists} onListsChanged={loadLists} onClose={() => setModal(null)} onImported={imported} />}
    </div>
  );
}
