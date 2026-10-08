import { useEffect, useState } from "react";
import { RiCheckLine, RiCloseLine, RiLoader4Line, RiRocket2Line, RiSearchEyeLine } from "react-icons/ri";
import { Title } from "@/components/onboarding/fields";

const SEARCH_LINES = [
  "Matching profiles against your ICP",
  "Filtering by role, industry, and location fit",
  "Scoring leads with AI fit signals",
  "Prioritizing the strongest opportunities",
];

export interface SampleLead {
  id: string;
  full_name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  headline: string | null;
  industry: string | null;
  linkedin_url: string | null;
  profile_image_url: string | null;
  signal_title?: string | null;
}

export function SearchStep({ pending }: { pending: boolean }) {
  const [done, setDone] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setDone((value) => (value < SEARCH_LINES.length - 1 ? value + 1 : value)), 900);
    return () => clearInterval(timer);
  }, [pending]);
  return (
    <div className="py-6">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><RiSearchEyeLine size={22} /></div>
      <Title title="Searching for leads matching your ICP..." text="Analyzing profiles, signals, and company data" />
      <ul className="mx-auto max-w-md space-y-2 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-4 py-3">
        {SEARCH_LINES.map((line, index) => {
          const finished = index < done;
          const current = index === done && pending;
          return (
            <li key={line} className="flex items-center gap-2 text-sm">
              {finished ? <RiCheckLine className="text-success" size={16} /> : current ? <RiLoader4Line className="animate-spin text-primary" size={16} /> : <span className="h-4 w-4" />}
              <span className={finished ? "text-base-content/80" : "text-base-content/45"}>{line}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function LeadsStep({ leads, note, onReject }: { leads: SampleLead[]; note: string; onReject: (id: string) => void }) {
  return (
    <div>
      <Title title="Here are the first opportunities we identified for you" text="Your agent will use your ICP to find more." />
      {note && <p className="mb-3 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-4 py-3 text-sm text-base-content/70">{note}</p>}
      {!note && leads.length === 0 && <p className="mb-3 text-center text-sm text-base-content/55">No sample leads came back from this search. You can still launch, and the agent will keep looking.</p>}
      <ul className="space-y-2">
        {leads.map((lead) => (
          <li key={lead.id} className="flex items-start justify-between gap-3 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 px-4 py-3">
            <div className="flex min-w-0 gap-3">
              <Avatar name={lead.full_name || "?"} src={lead.profile_image_url} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {lead.full_name || "Unknown"}
                  {lead.linkedin_url && <a href={lead.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex h-4 items-center rounded-[3px] bg-[#0a66c2] px-1 text-[10px] font-semibold text-white">in</a>}
                </p>
                <p className="truncate text-xs text-base-content/55">{[lead.title || lead.headline, lead.company].filter(Boolean).join(" · ") || "No title yet"}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {lead.industry && <span className="rounded-full bg-base-200 px-2 py-0.5 text-[11px] text-base-content/60">{lead.industry}</span>}
                  {lead.location && <span className="rounded-full bg-base-200 px-2 py-0.5 text-[11px] text-base-content/60">{lead.location}</span>}
                  {lead.signal_title && <span className="rounded-full bg-base-200 px-2 py-0.5 text-[11px] text-base-content/60">{lead.signal_title}</span>}
                </div>
              </div>
            </div>
            <button type="button" className="inline-flex shrink-0 items-center gap-1 text-xs text-base-content/45 hover:text-error" onClick={() => onReject(lead.id)}><RiCloseLine size={14} /> Reject</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Avatar({ name, src }: { name: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      // LinkedIn profile photos are remote and short-lived, so they stay as a plain image.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" onError={() => setFailed(true)} />
    );
  }
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral text-sm font-medium text-neutral-content">{name.slice(0, 1).toUpperCase()}</span>;
}

export function LaunchingStep() {
  return (
    <div className="onboard-title py-10">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><RiRocket2Line size={22} /></div>
      <h2 className="text-[26px] leading-[1.2]">Launching your agent...</h2>
      <p className="mt-2 text-sm text-base-content/55">Creating your agent and first campaign</p>
      <RiLoader4Line className="mx-auto mt-5 animate-spin text-primary" size={22} />
    </div>
  );
}
