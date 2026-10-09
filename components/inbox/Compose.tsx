import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiArrowDownSLine, RiCloseLine, RiLoader4Line, RiSearchLine, RiSendPlane2Line, RiUserAddLine } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { PersonAvatar } from "@/components/inbox/kit";

/** "Send a new message": pick a contact, write, send from the chosen LinkedIn account. */

interface Contact { id: string; full_name: string | null; title: string | null; headline: string | null; company: string | null; profile_image_url?: string | null }

export default function Compose({ account, onClose }: { account: { id: string; name: string }; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(true);
  const [results, setResults] = useState<Contact[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/leads?${new URLSearchParams({ scope: "all", status: "all", sort: "newest", limit: "20", q })}`)
        .then((r) => r.json()).then((d) => setResults(d.leads ?? [])).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function send() {
    if (!contact || !body.trim()) return;
    setSending(true);
    try {
      const r = await fetch("/api/inbox/compose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: account.id, target_id: contact.id, body: body.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Could not send");
      toast.success(`Message sent to ${contact.full_name}`);
      onClose();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not send"); }
    finally { setSending(false); }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] bg-gradient-to-r from-primary/[0.03] to-primary/[0.06] px-6 py-4">
        <div ref={wrap} className="relative w-full max-w-[560px]">
          <button type="button" onClick={() => setOpen(!open)} className="flex h-11 w-full items-center gap-3 rounded-[10px] border border-[var(--border-strong)] bg-base-100 px-3 text-left">
            {contact ? <><PersonAvatar name={contact.full_name} photo={contact.profile_image_url} size={26} /><span className="truncate text-[15px]">{contact.full_name}</span>{contact.company && <span className="truncate text-[14px] text-base-content/50">· {contact.company}</span>}</>
              : <span className="text-[15px] italic text-base-content/50">Search and select a contact</span>}
            <RiArrowDownSLine size={20} className="ml-auto shrink-0 text-base-content/50" />
          </button>
          {open && (
            <div className="wizard-rise absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-[12px] border border-[var(--border-subtle)] bg-base-100 shadow-[var(--shadow-overlay)]">
              <div className="relative border-b border-[var(--border-subtle)] p-2">
                <RiSearchLine size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-base-content/45" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts by name or company" className="h-10 w-full rounded-[8px] border border-primary/40 pl-9 pr-3 text-[15px] outline-none" />
              </div>
              <ul className="max-h-72 overflow-y-auto p-1">
                {results.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => { setContact(c); setOpen(false); }} className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left hover:bg-base-200">
                      <PersonAvatar name={c.full_name} photo={c.profile_image_url} size={32} />
                      <span className="min-w-0"><span className="block truncate text-[15px]">{c.full_name}</span><span className="block truncate text-[13px] text-base-content/55">{[c.title ?? c.headline, c.company].filter(Boolean).join(" · ")}</span></span>
                    </button>
                  </li>
                ))}
                {!results.length && <li className="px-3 py-3 text-[14px] text-base-content/50">No contacts found</li>}
              </ul>
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} title="Cancel" aria-label="Cancel new message" className="ml-auto flex h-10 w-10 items-center justify-center rounded-[10px] text-base-content/60 hover:bg-base-200"><RiCloseLine size={22} /></button>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        {contact ? <>
          <PersonAvatar name={contact.full_name} photo={contact.profile_image_url} size={96} />
          <div className="mt-2 text-[22px] font-medium">{contact.full_name}</div>
          <div className="text-[16px] text-base-content/65">{contact.title ?? contact.headline}</div>
          <div className="text-[14px] text-base-content/45">This message will be sent from {account.name}</div>
        </> : <>
          <RiUserAddLine size={56} className="text-base-content/25" />
          <div className="text-[17px] text-base-content/55">Select a contact to start a new conversation</div>
        </>}
      </div>
      <div className="border-t border-[var(--border-subtle)] px-6 py-4">
        <div className="rounded-[14px] border border-[var(--border-strong)] bg-base-100 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-[var(--ring)]">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} disabled={!contact} placeholder="Type a message..." aria-label="Message"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }}
            className="block w-full resize-none rounded-[14px] bg-transparent px-4 pt-3 text-[15px] outline-none placeholder:text-base-content/40 disabled:cursor-not-allowed" />
          <div className="flex justify-end px-3 pb-2.5">
            <button type="button" onClick={() => void send()} disabled={!contact || !body.trim() || sending}
              className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-primary px-4 text-[14px] font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:bg-base-200 disabled:text-base-content/35">
              {sending ? <RiLoader4Line size={16} className="animate-spin" /> : <RiSendPlane2Line size={16} />} Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
