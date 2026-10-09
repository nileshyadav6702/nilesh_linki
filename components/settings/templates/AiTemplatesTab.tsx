import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { LuFileText, LuInfo, LuLoaderCircle, LuMail, LuPlus, LuSparkles, LuTrash2 } from "react-icons/lu";
import { RiLinkedinBoxFill } from "react-icons/ri";
import Listbox from "@/components/agents/leads/Listbox";
import Confirm from "@/components/contacts/Confirm";
import TemplateEditor, { KIND_META, type Examples, type TemplateRow } from "@/components/settings/templates/TemplateEditor";
import { BRAND } from "@/lib/brand";

/** Settings → AI Outreach Templates: which templates the AI writes from, and the templates themselves. */

const card = "rounded-[16px] border border-[var(--border-subtle)] bg-base-100";
const when = (iso: string) => { const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`); return Number.isNaN(d.getTime()) ? "" : format(d, "MMM d, yyyy"); };

export default function AiTemplatesTab() {
  const [data, setData] = useState<{ templates: TemplateRow[]; mode: "default" | "custom"; examples: Examples } | null>(null);
  const [editing, setEditing] = useState<TemplateRow | "new" | null>(null);
  const [removing, setRemoving] = useState<TemplateRow | null>(null);

  const load = useCallback(() => fetch("/api/ai-templates").then((r) => r.json()).then(setData).catch(() => toast.error("Could not load templates")), []);
  useEffect(() => { void load(); }, [load]);

  async function setMode(mode: string) {
    const r = await fetch("/api/ai-templates", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
    if (!r.ok) { toast.error("Could not change the default template"); return; }
    toast.success(mode === "custom" ? "Agents now write from your templates where one fits" : `Agents now write with ${BRAND.name}'s default template`);
    await load();
  }

  async function remove() {
    if (!removing) return;
    const r = await fetch(`/api/ai-templates/${removing.id}`, { method: "DELETE" });
    if (!r.ok) { toast.error("Could not delete the template"); return; }
    toast.success(`"${removing.name}" deleted`);
    setRemoving(null);
    await load();
  }

  if (!data) return <div className="flex justify-center py-20"><LuLoaderCircle size={26} className="animate-spin text-primary" /></div>;
  if (editing) return (
    <TemplateEditor initial={editing === "new" ? null : editing} examples={data.examples} onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); void load(); }} />
  );

  const custom = data.mode === "custom";
  const create = () => setEditing("new");
  return (
    <div className="wizard-rise space-y-6">
      <div className={`${card} flex flex-wrap items-center justify-between gap-4 px-8 py-6`}>
        <div>
          <div className="flex items-center gap-3"><LuSparkles size={26} className="text-primary" /><div role="heading" aria-level={2} className="text-[24px] font-semibold">Outreach Templates</div></div>
          <div className="mt-1.5 text-[17px] text-base-content/70">Control how {BRAND.name} writes your LinkedIn and email outreach messages.</div>
        </div>
        <button type="button" onClick={create} className="inline-flex h-12 items-center gap-2 rounded-[10px] bg-primary px-6 text-[17px] font-semibold text-primary-content shadow-[0_6px_16px_-8px_var(--color-primary)] hover:bg-[var(--primary-hover)]"><LuPlus size={20} />Create new template</button>
      </div>

      <div className={`${card} px-6 py-6`}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="text-[19px] font-semibold">Default template</span><span className="text-[15px] text-base-content/60">What agents write from, unless an agent says otherwise</span></div>
        <Listbox label="Default template" value={data.mode} onChange={(v) => void setMode(v)}
          options={[{ value: "default", label: `${BRAND.name}'s default template` }, { value: "custom", label: `Your templates (${data.templates.length})`, count: data.templates.length }]}
          className="mt-3 w-full max-w-[580px] [&>button]:h-[52px] [&>button]:rounded-[10px] [&>button]:border-[var(--border-strong)] [&>button]:px-4 [&>button]:text-[17px]" />
        <div className="mt-4 flex items-start gap-4 rounded-[12px] bg-primary/[0.06] px-6 py-4">
          <LuInfo size={22} className="mt-0.5 shrink-0" style={{ color: "#4f46e5" }} />
          <div>
            <div className="text-[17px] font-semibold" style={{ color: "#4f46e5" }}>{custom ? "Agents write from your templates" : `${BRAND.name} writes from "${BRAND.name}'s default template"`}</div>
            <div className="mt-0.5 text-[15px]" style={{ color: "#4f46e5cc" }}>
              {custom ? "For each message, the newest template for that channel and step (icebreaker, follow-up or closing) is followed. Steps without one use the default writing." : "Each message is personalised with the lead's profile, company info, and detected signals."}
            </div>
          </div>
        </div>
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="border-b border-[var(--border-subtle)] px-6 py-5">
          <div className="flex items-center gap-2.5"><span className="text-[20px] font-semibold">Your templates</span><span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-base-200 px-2 text-[14px] tabular-nums">{data.templates.length}</span></div>
          <div className="mt-1 text-[15px] text-base-content/60">LinkedIn and email outreach templates used by your agents.</div>
        </div>
        {data.templates.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <LuFileText size={48} className="text-base-content/50" />
            <div className="text-[20px] font-medium">No custom templates yet</div>
            <div className="text-[17px] text-base-content/65">Create your first template to customize AI outreach for LinkedIn and email</div>
            <button type="button" onClick={create} className="mt-2 inline-flex h-11 items-center gap-2 rounded-[10px] bg-primary px-5 text-[16px] font-semibold text-primary-content hover:bg-[var(--primary-hover)]"><LuPlus size={18} />Create Your First Template</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-base-200/40">
                <tr className="text-left text-[14px] font-semibold tracking-[0.04em] text-base-content/60 [text-transform:uppercase]">
                  <th className="px-6 py-4">Template</th><th className="px-6 py-4">Status</th><th className="px-6 py-4"># Agents using</th><th className="px-6 py-4">Updated</th><th className="w-16 px-4" />
                </tr>
              </thead>
              <tbody>
                {data.templates.map((t) => {
                  const used = (t.agents_using ?? 0) > 0;
                  return (
                    <tr key={t.id} onClick={() => setEditing(t)} className="cursor-pointer border-t border-[var(--border-subtle)] transition-colors hover:bg-base-200/40">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-base-200/70">{t.channel === "linkedin" ? <RiLinkedinBoxFill size={24} style={{ color: "#3f2bd1" }} /> : <LuMail size={21} style={{ color: "#e5484d" }} />}</span>
                          <div className="min-w-0"><div className="truncate text-[17px] font-medium">{t.name}</div><div className="flex items-center gap-1.5 text-[15px] text-base-content/60">{KIND_META[t.kind].icon}{KIND_META[t.kind].label}</div></div>
                        </div>
                      </td>
                      <td className="px-6"><span title={used ? "An agent writes with this template" : custom ? "No agent has a step this template applies to, or a newer one replaces it" : "Default template is selected above"}
                        className={`inline-flex h-8 items-center rounded-full border px-3 text-[14px] ${used ? "border-success/30 bg-success/10 text-[#1f8a4c]" : "border-[var(--border-subtle)] bg-base-200/60 text-base-content/70"}`}>{used ? "Used" : "Unused"}</span></td>
                      <td className="px-6 text-[16px] tabular-nums text-base-content/75">{used ? t.agents_using : "—"}</td>
                      <td className="px-6 text-[16px] text-base-content/75">{when(t.updated_at)}</td>
                      <td className="px-4 text-right">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setRemoving(t); }} aria-label={`Delete ${t.name}`} className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] text-base-content/50 hover:bg-[#ef4444]/10 hover:text-[#ef4444]"><LuTrash2 size={20} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {removing && <Confirm title={`Delete "${removing.name}"?`} action="Delete template" onCancel={() => setRemoving(null)} onConfirm={remove}
        text={<>Agents stop writing from it right away{custom ? " and use another matching template or the default writing" : ""}. Messages already written aren&apos;t changed.</>} />}
    </div>
  );
}
