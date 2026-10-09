import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RiInformationLine, RiLinkedinBoxFill, RiLoader4Line } from "react-icons/ri";
import LinkedInImportModal from "@/components/agents/sources/LinkedInImportModal";
import type { ListRow } from "@/components/agents/sources/SavedListPanel";
import type { WizardState } from "@/components/agents/wizard/types";

/**
 * Import from LinkedIn inside the Sources step. Reuses the agent page's import modal, which
 * attaches its list to an agent, so the agent is created (as a draft) when the modal opens.
 */
export default function LinkedInImportPanel({ state, set, ensureAgent }: {
  state: WizardState; set: (p: Partial<WizardState>) => void; ensureAgent: () => Promise<string>;
}) {
  const [lists, setLists] = useState<ListRow[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const loadLists = useCallback(() => {
    fetch("/api/lists").then((r) => r.json()).then((l) => setLists(Array.isArray(l) ? l : [])).catch(() => {});
  }, []);
  useEffect(() => { loadLists(); }, [loadLists]);
  const done = state.linkedinImport;

  async function open() {
    setOpening(true);
    try { setAgentId(await ensureAgent()); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Could not prepare the agent"); }
    finally { setOpening(false); }
  }

  return (
    <section className="wizard-rise flex flex-col items-center gap-4 rounded-[16px] border border-[var(--border-subtle)] bg-base-100 px-6 py-12 text-center">
      <span className="flex h-[72px] w-[72px] items-center justify-center rounded-[18px] bg-primary/10 text-primary"><RiLinkedinBoxFill size={40} /></span>
      <h3 className="text-[24px] font-medium">Import from LinkedIn</h3>
      <p className="text-[17px] text-base-content/60">Supported sources include: Search, Post Likers &amp; Commenters, SalesNav...</p>
      <button type="button" onClick={() => void open()} disabled={opening}
        className="inline-flex h-12 items-center gap-2 rounded-[8px] bg-primary px-6 text-[17px] font-medium text-primary-content shadow-sm transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-60">
        {opening ? <RiLoader4Line size={20} className="animate-spin" /> : <RiLinkedinBoxFill size={20} />} Import from LinkedIn
      </button>
      {done && (
        <div className="wizard-rise mt-2 flex max-w-[740px] items-start gap-3 rounded-[12px] bg-[#eef0fb] px-6 py-4 text-left text-[17px] text-[#4f5bd5]">
          <RiInformationLine size={20} className="mt-1 shrink-0" />
          <p>Imported leads land in the <b className="font-semibold">{done.listName}</b> list, which will be linked to this campaign.</p>
        </div>
      )}
      {agentId && (
        <LinkedInImportModal agentId={agentId} lists={lists} onListsChanged={loadLists} onClose={() => setAgentId(null)}
          onImported={(into) => { set({ linkedinImport: into, listIds: [into.listId] }); loadLists(); }} />
      )}
    </section>
  );
}
