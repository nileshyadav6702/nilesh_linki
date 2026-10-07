import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RiCheckDoubleLine, RiCheckLine, RiCloseLine, RiExternalLinkLine } from "react-icons/ri";
import { Card, Empty, inputCls, PageHeader, primaryBtn, secondaryBtn, SignalChip, textareaCls } from "@/components/agents/ui";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

interface Draft {
  id: string; target_id: string; channel: string; subject: string | null; body: string; auto_approve_at: string | null;
  full_name: string | null; headline: string | null; company: string | null; linkedin_url: string | null; lead_score: number | null; fit_reason: string | null;
  agent_name: string | null; signal_type: string | null; signal_title: string | null; signal_snippet: string | null; signal_url: string | null;
}

/** Copilot queue: every first touch an agent wants to send, reviewed one by one or in bulk. */
export default function ApprovalsPage() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [edits, setEdits] = useState<Record<string, { subject?: string; body?: string }>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const load = useCallback(() => fetch("/api/approvals").then((r) => r.json()).then((d) => { setDrafts(d); setChecked(new Set()); }).catch(() => setDrafts([])), []);
  useEffect(() => { load(); }, [load]);

  async function decide(d: Draft, decision: "approve" | "reject") {
    const e = edits[d.id] ?? {};
    const r = await fetch(`/api/approvals/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, ...e }) });
    const res = await r.json();
    if (!r.ok) return toast.error(res.error ?? "Failed");
    toast.success(decision === "approve" ? (res.enrolled ? `${d.full_name ?? "Lead"} added to the campaign` : "Approved") : "Rejected");
    setDrafts((list) => list?.filter((x) => x.id !== d.id) ?? null);
  }

  async function bulk(decision: "approve" | "reject") {
    const ids = [...checked];
    if (!ids.length) return;
    const r = await fetch("/api/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, decision }) });
    if (!r.ok) return toast.error((await r.json()).error ?? "Failed");
    toast.success(`${ids.length} draft${ids.length === 1 ? "" : "s"} ${decision === "approve" ? "approved" : "rejected"}`);
    load();
  }

  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <Head><title>Approvals — Linki</title></Head>
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader eyebrow="AI SDR" title="Approvals" subtitle="Review what your agents want to send. Edits are kept; approved leads join the campaign."
          actions={drafts && drafts.length > 0 ? <>
            <button className={secondaryBtn} onClick={() => setChecked(checked.size === drafts.length ? new Set() : new Set(drafts.map((d) => d.id)))}>{checked.size === drafts.length ? "Clear" : "Select all"}</button>
            <button className={primaryBtn} disabled={!checked.size} onClick={() => bulk("approve")}><RiCheckDoubleLine size={16} /> Approve {checked.size || ""}</button>
          </> : null} />

        {drafts === null ? <p className="text-sm text-base-content/40">Loading…</p> : drafts.length === 0 ? (
          <Empty title="Nothing to review"><p>New drafts appear as agents qualify leads. <Link className="underline" href="/leads">See all leads</Link>.</p></Empty>
        ) : drafts.map((d) => (
          <Card key={d.id} className="space-y-3">
            <div className="flex items-start gap-3">
              <input type="checkbox" className="checkbox checkbox-sm mt-1" checked={checked.has(d.id)} onChange={() => toggle(d.id)} aria-label="Select draft" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/contacts/${d.target_id}`} className="text-sm font-semibold hover:underline">{d.full_name ?? "Lead"}</Link>
                  {d.linkedin_url && <a href={d.linkedin_url} target="_blank" rel="noreferrer" className="text-base-content/40 hover:text-base-content" aria-label="LinkedIn"><RiExternalLinkLine size={13} /></a>}
                  {d.lead_score !== null && <span className="text-xs tabular-nums text-base-content/50">score {Math.round(d.lead_score)}</span>}
                  <span className="text-xs text-base-content/40">{d.channel === "email" ? "Email" : "LinkedIn"} · {d.agent_name}</span>
                </div>
                <p className="truncate text-xs text-base-content/55">{d.headline ?? d.company}</p>
                {d.signal_title && (
                  <p className="mt-1.5 flex items-center gap-2 text-xs text-base-content/60">{d.signal_type && <SignalChip type={d.signal_type} />}<span className="truncate">{d.signal_title}{d.signal_snippet ? ` — ${d.signal_snippet}` : ""}</span></p>
                )}
              </div>
            </div>
            {d.channel === "email" && <input className={inputCls} defaultValue={d.subject ?? ""} onChange={(e) => setEdits({ ...edits, [d.id]: { ...edits[d.id], subject: e.target.value } })} aria-label="Subject" />}
            <textarea className={textareaCls} rows={5} defaultValue={d.body} onChange={(e) => setEdits({ ...edits, [d.id]: { ...edits[d.id], body: e.target.value } })} aria-label="Message" />
            <div className="flex flex-wrap items-center gap-2">
              <button className={primaryBtn} onClick={() => decide(d, "approve")}><RiCheckLine size={16} /> Approve</button>
              <button className={secondaryBtn} onClick={() => decide(d, "reject")}><RiCloseLine size={16} /> Reject</button>
              {d.auto_approve_at && <span className="text-xs text-base-content/45">Autopilot sends at {new Date(d.auto_approve_at).toLocaleTimeString()}</span>}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
