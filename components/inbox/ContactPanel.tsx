import { useEffect, useState } from "react";
import { format } from "date-fns";
import { RiArrowRightSLine, RiLinkedinBoxFill } from "react-icons/ri";
import { PersonAvatar } from "@/components/inbox/kit";

interface Contact {
  id: string; full_name: string | null; title: string | null; headline: string | null; company: string | null; company_logo: string | null;
  location: string | null; linkedin_url: string | null; profile_image_url: string | null;
  signal: { type: string; title: string; occurred_at: string } | null;
}

function when(iso: string): string | null {
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? null : format(t, "MMMM yyyy");
}

/**
 * Right-hand panel of the inbox: who this conversation is with, when they're a saved contact
 * (company, strongest signal, location). "View more" opens the full lead panel.
 */
export default function ContactPanel({ threadId, onViewMore }: { threadId: string; onViewMore: (targetId: string) => void }) {
  const [c, setC] = useState<Contact | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    // Fetch-on-select: the contact behind the conversation.
    void (async () => {
      setC(undefined);
      const d = await fetch(`/api/inbox/threads/${threadId}/contact`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (alive) setC(d?.contact ?? null);
    })();
    return () => { alive = false; };
  }, [threadId]);

  if (!c) return null;
  const role = c.title ?? c.headline;
  const signalWhen = c.signal ? when(c.signal.occurred_at) : null;
  const rows: Array<[string, React.ReactNode]> = [
    ["Company", c.company ? (
      <span className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {c.company_logo && <img src={c.company_logo} alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-[4px] object-cover ring-1 ring-[var(--border-subtle)]" />}
        {c.company}
      </span>
    ) : null],
    ["Signal", c.signal ? <>{c.signal.title}{signalWhen && !c.signal.title.includes(signalWhen) && <span className="text-base-content/50"> · {signalWhen}</span>}</> : null],
    ["Location", c.location],
  ];

  return (
    <aside className="wizard-rise hidden w-[340px] shrink-0 flex-col overflow-hidden rounded-[16px] border border-[var(--border-subtle)] bg-base-100 xl:flex">
      <header className="border-b border-[var(--border-subtle)] px-6 py-4">
        <div className="text-[18px] font-semibold">Contact Information</div>
        {c.company && <div className="truncate text-[14px] uppercase tracking-wide text-base-content/55">{c.company}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="flex flex-col items-center text-center">
          <PersonAvatar name={c.full_name} photo={c.profile_image_url} size={112} />
          <div className="mt-4 flex items-center gap-2 text-[21px] font-semibold">
            {c.full_name ?? "Unknown"}
            {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" aria-label="LinkedIn profile" className="text-[#0a66c2] hover:opacity-80"><RiLinkedinBoxFill size={24} /></a>}
          </div>
          {role && <div className="mt-1 line-clamp-2 text-[16px] text-base-content/65">{role}</div>}
        </div>
        <dl className="mt-7 space-y-5">
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[13px] font-semibold uppercase tracking-[0.08em] text-base-content/50">{k}</dt>
              <dd className="mt-1.5 text-[16px] leading-snug text-base-content/85">{v}</dd>
            </div>
          ))}
        </dl>
        <button type="button" onClick={() => onViewMore(c.id)} className="mt-7 inline-flex w-full items-center gap-1 border-t border-[var(--border-subtle)] pt-5 text-[16px] font-medium text-[#4f46e5] hover:underline">
          View more <RiArrowRightSLine size={22} />
        </button>
      </div>
    </aside>
  );
}
