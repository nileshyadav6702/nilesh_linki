import { RiCornerDownRightLine, RiLinkedinBoxFill, RiMailLine } from "react-icons/ri";
import type { AgentRow, ChannelRow, SourceRow } from "@/lib/insights/report";
import { Card, CategoryChip, HELP, Num, StatusBadge, Th, rate, useSort } from "@/components/insights/kit";

const row = "border-t border-[var(--border-subtle)] transition-colors hover:bg-base-200/40";
const head = "bg-base-200/40";

export function AgentTable({ rows, onPick }: { rows: AgentRow[]; onPick: (id: string) => void }) {
  const { sort, toggle, apply } = useSort<"found" | "contacted" | "replied" | "interested">(null);
  const sorted = apply(rows, (r, k) => r[k]);
  return (
    <Card title="Agent performance">
      <div className="overflow-x-auto lg:overflow-visible">
        <table className="w-full min-w-[820px] table-fixed">
          <colgroup><col /><col className="w-[150px]" /><col className="w-[200px]" /><col className="w-[200px]" /><col className="w-[200px]" /></colgroup>
          <thead className={head}><tr>
            <Th>Agent</Th>
            <Th align="right" sortKey="found" sort={sort} onSort={(k) => toggle(k as "found")}>Found</Th>
            <Th align="right" sortKey="contacted" sort={sort} onSort={(k) => toggle(k as "contacted")} help={HELP.contacted}>Contacted</Th>
            <Th align="right" sortKey="replied" sort={sort} onSort={(k) => toggle(k as "replied")} help={HELP.replied} helpAlign="right">Replied</Th>
            <Th align="right" sortKey="interested" sort={sort} onSort={(k) => toggle(k as "interested")} help={HELP.interested} helpAlign="right">Interested</Th>
          </tr></thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.id} className={row}>
                <td className="px-6 py-5">
                  <button type="button" onClick={() => onPick(a.id)} title={`Show insights for ${a.name}`} className="flex max-w-full items-center gap-3 text-left">
                    <span className="truncate text-[18px] text-base-content hover:underline">{a.name}</span><StatusBadge status={a.status} />
                  </button>
                </td>
                <td className="px-6 text-right"><Num n={a.found} /></td>
                <td className="px-6 text-right"><Num n={a.contacted} /></td>
                <td className="px-6 text-right"><Num n={a.replied} of={a.messaged} /></td>
                <td className="px-6 text-right"><Num n={a.interested} of={a.replied} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="px-6 py-10 text-center text-[15px] text-base-content/50">No agents yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function SourceTable({ rows, sub }: { rows: SourceRow[]; sub?: string }) {
  const { sort, toggle, apply } = useSort<"leads" | "replied" | "interested">("leads");
  const sorted = apply(rows, (r, k) => r[k]);
  return (
    <Card title="Lead source performance" sub={sub}>
      <div className="overflow-x-auto lg:overflow-visible">
        <table className="w-full min-w-[820px] table-fixed">
          <colgroup><col /><col className="w-[30%]" /><col className="w-[140px]" /><col className="w-[180px]" /><col className="w-[180px]" /></colgroup>
          <thead className={head}><tr>
            <Th>Source</Th><Th>Type</Th>
            <Th align="right" sortKey="leads" sort={sort} onSort={(k) => toggle(k as "leads")}>Leads</Th>
            <Th align="right" sortKey="replied" sort={sort} onSort={(k) => toggle(k as "replied")} help={HELP.replied} helpAlign="right">Replied</Th>
            <Th align="right" sortKey="interested" sort={sort} onSort={(k) => toggle(k as "interested")} help={HELP.interested} helpAlign="right">Interested</Th>
          </tr></thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.key} className={row}>
                <td className="truncate px-6 py-6 text-[18px] text-base-content" title={s.name}>{s.name}</td>
                <td className="px-6"><CategoryChip category={s.category} /></td>
                <td className="px-6 text-right"><Num n={s.leads} /></td>
                <td className="px-6 text-right"><Num n={s.replied} /></td>
                <td className="px-6 text-right"><Num n={s.interested} muted bold={false} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="px-6 py-10 text-center text-[15px] text-base-content/50">No lead sources in this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function ChannelTable({ rows, sub }: { rows: ChannelRow[]; sub?: string }) {
  return (
    <Card title="Channel performance" sub={sub}>
      <div className="overflow-x-auto lg:overflow-visible">
        <table className="w-full min-w-[720px] table-fixed">
          <colgroup><col /><col className="w-[200px]" /><col className="w-[240px]" /><col className="w-[220px]" /></colgroup>
          <thead className={head}><tr>
            <Th>Step</Th><Th align="right">Sent</Th><Th align="right" help={HELP.accepted} helpAlign="right">Accepted</Th>
            <Th align="right" help={HELP.replied} helpAlign="right">Replied</Th>
          </tr></thead>
          <tbody>
            {rows.map((c) => {
              const li = c.channel === "linkedin";
              return [
                <tr key={c.channel} className={row}>
                  <td className="px-6 py-5">
                    <span className="flex items-center gap-3">
                      <span className={`flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--border-subtle)] ${li ? "text-[#0a66c2]" : "text-primary"}`}>
                        {li ? <RiLinkedinBoxFill size={20} /> : <RiMailLine size={18} />}
                      </span>
                      <span className="text-[18px] text-base-content">{li ? "LinkedIn" : "Email"}</span>
                      <span className="text-[15px] text-base-content/55">{rate(c.replied, c.messaged)} reply rate across all steps</span>
                    </span>
                  </td>
                  <td className="px-6 text-right"><Num n={c.sent} /></td>
                  <td className="px-6 text-right text-[18px] text-base-content/40">—</td>
                  <td className="px-6 text-right"><Num n={c.replied} /></td>
                </tr>,
                ...c.steps.map((s) => (
                  <tr key={s.id} className={row}>
                    <td className="py-5 pl-9 pr-6">
                      <span className="flex items-center gap-2 text-[17px] text-base-content/85">
                        <RiCornerDownRightLine size={16} className="shrink-0 text-base-content/35" />Step {s.n} · {s.label}
                      </span>
                    </td>
                    <td className="px-6 text-right"><Num n={s.sent} bold={false} /></td>
                    <td className="px-6 text-right">{s.accepted === null ? <span className="text-[18px] text-base-content/40">—</span> : <Num n={s.accepted} of={s.sent} bold={false} />}</td>
                    <td className="px-6 text-right">{s.replied ? <Num n={s.replied} bold={false} /> : <span className="text-[18px] text-base-content/40">—</span>}</td>
                  </tr>
                )),
              ];
            })}
            {!rows.length && <tr><td colSpan={4} className="px-6 py-10 text-center text-[15px] text-base-content/50">This agent has no campaign steps yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
