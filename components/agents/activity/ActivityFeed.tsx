import { Fragment, useEffect, useMemo, useState } from "react";
import type { ActivityFeedItem, ActivityPage } from "@/lib/agents/activity-feed";
import { Pager } from "@/components/agents/leads/LeadsTable";
import { Empty, Panel } from "@/components/agents/ui";
import ActivityChips from "./ActivityChips";
import ActivityRow from "./ActivityRow";
import { CATEGORY, dayLabel, type ActivityFilter } from "./meta";

const PAGE_SIZE = 50;

/** Consecutive items under their day header ("Today", "Yesterday", …). Items arrive newest first. */
function byDay(items: ActivityFeedItem[]): Array<{ day: string; items: ActivityFeedItem[] }> {
  const groups: Array<{ day: string; items: ActivityFeedItem[] }> = [];
  for (const item of items) {
    const day = dayLabel(item.at);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

function Skeleton() {
  return (
    <ul aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex items-center gap-4 border-b border-[var(--border-subtle)] px-5 py-4 last:border-b-0">
          <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-base-200" />
          <div className="flex-1 space-y-2">
            <span className="block h-3.5 w-48 animate-pulse rounded bg-base-200" />
            <span className="block h-3 w-32 animate-pulse rounded bg-base-200" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The agent's Activity tab: category chips, a day-grouped feed and a pager. */
export default function ActivityFeed({ agentId, onViewLeads }: { agentId: string; onViewLeads?: (signalType: string) => void }) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ key: string; page: ActivityPage } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);

  const query = useMemo(() => new URLSearchParams({
    ...(filter === "all" ? {} : { category: filter }), limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE),
  }).toString(), [filter, page]);
  const key = `${agentId}?${query}#${retry}`;

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/agents/${encodeURIComponent(agentId)}/activity?${query}`, { signal: ctrl.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? "Could not load activity");
        setData({ key, page: body as ActivityPage });
        setError(null);
      })
      .catch((e: Error) => { if (e.name !== "AbortError") setError({ key, message: e.message }); });
    return () => ctrl.abort();
  }, [agentId, query, key]);

  const current = data?.page ?? null;
  const loading = data?.key !== key && error?.key !== key;
  const total = current?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const groups = useMemo(() => byDay(current?.items ?? []), [current]);
  const choose = (f: ActivityFilter) => { setFilter(f); setPage(0); };

  return (
    <div className="space-y-4">
      <ActivityChips value={filter} counts={current?.counts ?? null} onChange={choose} />

      {error?.key === key ? (
        <Empty title="Could not load activity">
          {error.message} · <button type="button" className="font-medium text-primary hover:underline" onClick={() => setRetry((n) => n + 1)}>Try again</button>
        </Empty>
      ) : loading && !current ? (
        <Panel className="overflow-hidden"><Skeleton /></Panel>
      ) : !total ? (
        <Empty title={filter === "all" ? "No activity yet" : `No ${CATEGORY[filter].label.toLowerCase()} activity yet`}>
          Lead discovery runs, campaign steps and setup changes will show up here.
        </Empty>
      ) : (
        <Panel className={`overflow-hidden transition-opacity ${loading ? "opacity-60" : ""}`}>
          <ul aria-busy={loading}>
            {groups.map((g, gi) => (
              <Fragment key={`${g.day}-${gi}`}>
                <li className="border-b border-[var(--border-subtle)] bg-base-200/60 px-6 py-3 text-[16px] text-base-content/70">{g.day}</li>
                {g.items.map((item) => <ActivityRow key={item.id} item={item} onViewLeads={onViewLeads} />)}
              </Fragment>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-6 py-4 text-[16px] text-base-content/50">
            <span className="tabular-nums">{`${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}</span>
            {pages > 1 && <Pager page={page} pages={pages} onPage={setPage} />}
          </div>
        </Panel>
      )}
    </div>
  );
}
