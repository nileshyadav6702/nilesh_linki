import type { ActivityFeedItem } from "@/lib/agents/activity-feed";
import { Avatar } from "@/components/agents/ui";
import { CATEGORY, markIcon, outcomeIcon, shortAgo, TONE_TEXT } from "./meta";

/**
 * One feed row: avatar or source mark, title/subtitle with the category tag and time, the outcome
 * in a fixed column (under the text on small screens) and an optional "View leads".
 */
export default function ActivityRow({ item, onViewLeads }: { item: ActivityFeedItem; onViewLeads?: (signalType: string) => void }) {
  const cat = CATEGORY[item.category];
  const o = item.outcome;
  const icon = o ? outcomeIcon(o.icon) : null;
  const signal = item.signal_type;
  return (
    <li className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-b border-[var(--border-subtle)] px-5 py-4 last:border-b-0 md:grid-cols-[40px_minmax(0,3fr)_minmax(0,2fr)_96px]">
      {item.lead
        ? <Avatar name={item.lead.name} src={item.lead.photo} size={40} />
        : <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-base-200 text-base-content/55" aria-hidden="true">{markIcon(item.mark ?? "source")}</span>}

      <div className="min-w-0">
        <p className="truncate text-[15px] font-medium text-base-content" title={item.title}>{item.title}</p>
        {item.subtitle && <p className="truncate text-[13px] text-base-content/55" title={item.subtitle}>{item.subtitle}</p>}
        <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-base-content/45">
          <span className="inline-flex items-center gap-1 rounded-[6px] bg-base-200 px-2 py-0.5 text-[12px] font-medium text-base-content/70">
            {cat.icon(13)} {cat.label}
          </span>
          <time dateTime={item.at} title={new Date(item.at).toLocaleString()}>· {shortAgo(item.at)}</time>
        </div>
      </div>

      {o && (
        <div className="col-start-2 min-w-0 md:col-start-3">
          <span className={`inline-flex max-w-full items-center gap-1.5 text-[15px] ${o.tone === "neutral" ? "" : "font-medium"} ${TONE_TEXT[o.tone]}`} title={o.hint ?? o.text}>
            {icon && <span className="shrink-0">{icon}</span>}
            <span className="truncate">{o.text}</span>
          </span>
        </div>
      )}

      {signal && onViewLeads && (
        <div className="col-start-2 md:col-start-4 md:justify-self-end">
          <button type="button" onClick={() => onViewLeads(signal)}
            className="inline-flex h-8 items-center rounded-[6px] border border-[var(--border-subtle)] bg-base-100 px-3 text-[12px] font-medium text-base-content/75 transition-colors hover:bg-base-200 hover:text-base-content">
            View leads
          </button>
        </div>
      )}
    </li>
  );
}
