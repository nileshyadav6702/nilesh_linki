import { RiAddLine, RiDeleteBinLine, RiFocus3Line, RiUser3Line } from "react-icons/ri";
import type { Icp } from "@/lib/icp/schema";
import { Field, fromList, ghostBtn, IconTile, inputCls, textareaCls, toList } from "@/components/agents/ui";

export const EMPTY_ICP: Icp = {
  company_name: "", company_industry: "", company_size: "", company_linkedin_url: "", offer: "", value_props: [], social_proof: [], language: "English",
  pain_points: [], industries: [], company_sizes: [], company_types: [], geographies: [],
  personas: [], competitors: [], keywords: [], exclusions: [], sales_nav_keywords: "",
  exclude_service_providers: false, ai_competitor_filtering: false, match_mode: "high_precision", mandatory_keywords: [],
};

function ListInput({ label, hint, value, onChange, rows = 2 }: { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; rows?: number }) {
  return (
    <Field label={label} hint={hint ?? "Separate with commas or new lines"}>
      <textarea rows={rows} className={textareaCls} defaultValue={fromList(value)} onBlur={(e) => onChange(toList(e.target.value))} />
    </Field>
  );
}

/** Every ICP field the AI drafted, editable before it is saved as a new version. */
export default function IcpEditor({ value, onChange }: { value: Icp; onChange: (icp: Icp) => void }) {
  const set = <K extends keyof Icp>(key: K, v: Icp[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your company"><input className={inputCls} value={value.company_name} onChange={(e) => set("company_name", e.target.value)} /></Field>
        <Field label="Offer in one sentence"><input className={inputCls} value={value.offer} onChange={(e) => set("offer", e.target.value)} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <ListInput label="Value props" value={value.value_props} onChange={(v) => set("value_props", v)} rows={3} />
        <ListInput label="Pain points you solve" value={value.pain_points} onChange={(v) => set("pain_points", v)} rows={3} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <ListInput label="Industries" value={value.industries} onChange={(v) => set("industries", v)} />
        <ListInput label="Company sizes" hint="e.g. 11-50, 51-200" value={value.company_sizes} onChange={(v) => set("company_sizes", v)} />
        <ListInput label="Geographies" value={value.geographies} onChange={(v) => set("geographies", v)} />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2.5 text-[15px] font-medium"><IconTile icon={<RiUser3Line size={16} />} tone="coral" size={32} />Buyer personas</h3>
          <button type="button" className={ghostBtn + " border border-[var(--border-subtle)]"} onClick={() => set("personas", [...value.personas, { name: "New persona", titles: [], seniority: [], departments: [], pains: [] }])}><RiAddLine size={14} /> Persona</button>
        </div>
        {value.personas.length === 0 && <p className="text-[15px] text-base-content/45">No personas yet. Add the job titles you sell to.</p>}
        {value.personas.map((p, i) => (
          <div key={i} className="grid gap-3 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-3 sm:grid-cols-[1fr_2fr_1fr_auto]">
            <input className={inputCls} value={p.name} aria-label="Persona name" onChange={(e) => set("personas", value.personas.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input className={inputCls} defaultValue={fromList(p.titles)} placeholder="Job titles, comma separated" aria-label="Job titles" onBlur={(e) => set("personas", value.personas.map((x, j) => j === i ? { ...x, titles: toList(e.target.value) } : x))} />
            <input className={inputCls} defaultValue={fromList(p.departments)} placeholder="Departments" aria-label="Departments" onBlur={(e) => set("personas", value.personas.map((x, j) => j === i ? { ...x, departments: toList(e.target.value) } : x))} />
            <button type="button" className={ghostBtn} aria-label="Remove persona" onClick={() => set("personas", value.personas.filter((_, j) => j !== i))}><RiDeleteBinLine size={14} /></button>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2.5 text-[15px] font-medium"><IconTile icon={<RiFocus3Line size={16} />} tone="amber" size={32} />Competitors</h3>
          <button type="button" className={ghostBtn + " border border-[var(--border-subtle)]"} onClick={() => set("competitors", [...value.competitors, { name: "", linkedin_url: null, website: null }])}><RiAddLine size={14} /> Competitor</button>
        </div>
        <p className="text-[13.5px] text-base-content/45">People who engage with these companies&apos; LinkedIn posts become leads. Their own employees are filtered out.</p>
        {value.competitors.map((c, i) => (
          <div key={i} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
            <input className={inputCls} value={c.name} placeholder="Name" aria-label="Competitor name" onChange={(e) => set("competitors", value.competitors.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input className={inputCls} value={c.linkedin_url ?? ""} placeholder="https://www.linkedin.com/company/…" aria-label="Competitor LinkedIn URL" onChange={(e) => set("competitors", value.competitors.map((x, j) => j === i ? { ...x, linkedin_url: e.target.value || null } : x))} />
            <button type="button" className={ghostBtn} aria-label="Remove competitor" onClick={() => set("competitors", value.competitors.filter((_, j) => j !== i))}><RiDeleteBinLine size={14} /></button>
          </div>
        ))}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <ListInput label="Topics your buyers post about" value={value.keywords} onChange={(v) => set("keywords", v)} rows={3} />
        <ListInput label="Exclude people whose profile mentions" value={value.exclusions} onChange={(v) => set("exclusions", v)} rows={3} />
      </div>
      <Field label="Sales Navigator keyword query" hint="Used to find lookalike leads when signals run dry">
        <input className={inputCls} value={value.sales_nav_keywords} onChange={(e) => set("sales_nav_keywords", e.target.value)} />
      </Field>
    </div>
  );
}
