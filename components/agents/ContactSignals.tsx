import Link from "next/link";
import { useEffect, useState } from "react";
import { RiExternalLinkLine } from "react-icons/ri";
import { ScoreBadge, SignalChip, timeAgo } from "@/components/agents/ui";

interface Data {
  score: { fit_score: number | null; fit_verdict: string | null; fit_reason: string | null; intent_score: number; lead_score: number | null; agent_name: string | null; agent_id: string | null } | null;
  signals: Array<{ id: string; type: string; title: string; snippet: string | null; source_url: string | null; occurred_at: string }>;
}

/** Buying signals and AI scoring for one contact. Renders nothing when there is neither. */
export default function ContactSignals({ targetId }: { targetId: string }) {
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => { fetch(`/api/targets/${targetId}/signals`).then((r) => r.ok ? r.json() : null).then(setD).catch(() => {}); }, [targetId]);
  if (!d || (!d.signals.length && d.score?.fit_score == null)) return null;
  return (
    <div className="bg-base-100 border border-[var(--border-subtle)] rounded-2xl shadow-[var(--shadow-raised)] p-5 mb-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-base-content/40 uppercase tracking-wide">Buying signals</p>
        <div className="flex items-center gap-2 text-xs text-base-content/50">
          {d.score?.agent_id && <Link className="underline" href={`/agents/${d.score.agent_id}`}>{d.score.agent_name}</Link>}
          <span>Intent {Math.round(d.score?.intent_score ?? 0)}</span>
          <ScoreBadge score={d.score?.lead_score} verdict={d.score?.fit_verdict} />
        </div>
      </div>
      {d.score?.fit_reason && <p className="text-sm text-base-content/70">{d.score.fit_reason}</p>}
      <ol className="space-y-2">
        {d.signals.map((s) => (
          <li key={s.id} className="flex gap-3">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-base-content/30" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><SignalChip type={s.type} /><span className="text-sm font-medium">{s.title}</span><span className="text-xs text-base-content/40">{timeAgo(s.occurred_at)}</span></div>
              {s.snippet && <p className="mt-0.5 text-sm text-base-content/60">{s.snippet}</p>}
              {s.source_url && <a className="inline-flex items-center gap-1 text-xs text-base-content/45 underline" href={s.source_url} target="_blank" rel="noreferrer">Source <RiExternalLinkLine size={11} /></a>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
