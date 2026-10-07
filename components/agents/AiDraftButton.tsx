import { useState } from "react";
import { toast } from "sonner";
import { RiLoader4Line, RiMagicLine } from "react-icons/ri";

/** Drafts an answer to an inbound reply with AI and hands it to the composer (never sends). */
export default function AiDraftButton({ replyId, onDraft }: { replyId: string | null | undefined; onDraft: (body: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (!replyId) return null;
  async function draft() {
    setBusy(true);
    try {
      const r = await fetch(`/api/inbox/${replyId}/draft`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onDraft(d.draft.body);
      toast.success("Draft ready — review before sending");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not draft a reply");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={draft} disabled={busy}
      className="inline-flex items-center gap-1.5 px-3 h-10 rounded-[10px] text-sm font-medium border border-[var(--border)] bg-base-100 text-base-content/75 hover:bg-base-200 disabled:opacity-40 transition-colors">
      {busy ? <RiLoader4Line size={14} className="animate-spin" /> : <RiMagicLine size={14} />}
      {busy ? "Drafting…" : "AI draft"}
    </button>
  );
}
