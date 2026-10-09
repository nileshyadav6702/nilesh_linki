import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiArchiveLine, RiDeleteBin6Line, RiFireLine, RiFireFill, RiLinkedinBoxFill, RiLoader4Line, RiMailLine, RiMailUnreadLine, RiMore2Fill, RiSendPlane2Line } from "react-icons/ri";
import { useDismiss } from "@/components/agents/leads/Listbox";
import { ago, PersonAvatar, type Message, type ThreadRow } from "@/components/inbox/kit";

/** Right pane: one conversation with its messages, triage actions and the reply box. */

function EmailBody({ html, text }: { html: string | null; text: string | null }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(200);
  if (!html) return <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{text ?? ""}</div>;
  // Sandboxed (no scripts, no same-origin): mail HTML can't touch the app. Height follows the content.
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0;font:15px/1.55 system-ui,sans-serif;color:#141413;word-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
  return (
    <iframe ref={ref} title="Email" sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin" srcDoc={doc} style={{ height: h }} className="w-full border-0 bg-transparent"
      onLoad={() => { const b = ref.current?.contentDocument?.body; if (b) setH(Math.min(4000, b.scrollHeight + 16)); }} />
  );
}

function Menu({ email, onArchive, onDelete }: { email: boolean; onArchive: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, [wrap], () => setOpen(false));
  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label="More actions" aria-expanded={open} className="flex h-10 w-10 items-center justify-center rounded-[10px] text-base-content/60 hover:bg-base-200 hover:text-base-content"><RiMore2Fill size={20} /></button>
      {open && (
        <div className="wizard-rise absolute right-0 top-full z-30 mt-1 w-52 rounded-[12px] border border-[var(--border-subtle)] bg-base-100 p-1 shadow-[var(--shadow-overlay)]">
          {email && <button type="button" onClick={() => { setOpen(false); onArchive(); }} className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-[15px] hover:bg-base-200"><RiArchiveLine size={18} /> Archive</button>}
          <button type="button" onClick={() => { setOpen(false); onDelete(); }} className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-[15px] text-error hover:bg-error/10"><RiDeleteBin6Line size={18} /> Delete chat</button>
        </div>
      )}
    </div>
  );
}

export default function ThreadView({ id, onChanged, onRemoved }: { id: string; onChanged: (patch: Partial<ThreadRow>) => void; onRemoved: () => void }) {
  const [data, setData] = useState<{ thread: ThreadRow & { url: string | null }; messages: Message[] } | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    // Fetch-on-select: the conversation is external data.
    void (async () => {
      setData(null); setDraft("");
      const d = await fetch(`/api/inbox/threads/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (alive) setData(d);
    })();
    return () => { alive = false; };
  }, [id]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [data?.messages.length]);

  if (!data) return <div className="flex flex-1 items-center justify-center"><RiLoader4Line size={26} className="animate-spin text-primary" /></div>;
  const t = data.thread;
  const linkedin = t.channel === "linkedin";

  async function patch(p: Partial<Record<"unread" | "interested" | "archived" | "deleted", boolean>>, ok: string) {
    const r = await fetch(`/api/inbox/threads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
    if (!r.ok) return toast.error("Could not update the conversation");
    toast.success(ok);
    const asRow = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ? 1 : 0])) as Partial<ThreadRow>;
    setData((d) => d && { ...d, thread: { ...d.thread, ...asRow } });
    if (p.deleted || p.archived) onRemoved(); else onChanged(asRow);
  }

  async function loadOlder() {
    setLoadingOlder(true);
    const d = await fetch(`/api/inbox/threads/${id}?history=1`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setLoadingOlder(false);
    if (d) setData(d);
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const r = await fetch(`/api/inbox/threads/${id}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Could not send");
      const now = new Date().toISOString();
      setData((cur) => cur && { ...cur, messages: [...cur.messages, { id: `local-${now}`, direction: "out", sender_name: "You", sender_email: null, body_text: body, body_html: null, sent_at: now }] });
      setDraft("");
      onChanged({ snippet: body, last_message_at: now });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not send"); }
    finally { setSending(false); }
  }

  const title = linkedin ? t.participant_name : t.subject || "(no subject)";
  const iconBtn = (on: boolean) => `flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors ${on ? "bg-primary/12 text-primary" : "text-base-content/60 hover:bg-base-200 hover:text-base-content"}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] bg-gradient-to-r from-primary/[0.03] to-primary/[0.06] px-6 py-4">
        {linkedin && <PersonAvatar name={t.participant_name} photo={t.participant_photo} size={40} />}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[18px] font-medium">{title}</span>
            {linkedin && t.participant_url && <a href={t.participant_url} target="_blank" rel="noreferrer" aria-label="LinkedIn profile" className="shrink-0 text-[#0a66c2] hover:opacity-80"><RiLinkedinBoxFill size={20} /></a>}
          </div>
          <div className="truncate text-[14px] text-base-content/60">
            {linkedin ? t.participant_headline ?? `${data.messages.length} message${data.messages.length === 1 ? "" : "s"}` : `${t.participant_name ?? t.participant_email ?? ""} · ${data.messages.length} message${data.messages.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <button type="button" title={t.interested ? "Remove interested" : "Mark as interested"} aria-pressed={!!t.interested} onClick={() => void patch({ interested: !t.interested }, t.interested ? "Removed from Interested" : "Marked as interested")} className={iconBtn(!!t.interested)}>
          {t.interested ? <RiFireFill size={20} /> : <RiFireLine size={20} />}
        </button>
        <button type="button" title="Mark as unread" onClick={() => void patch({ unread: true }, "Marked as unread")} className={iconBtn(false)}><RiMailUnreadLine size={20} /></button>
        <Menu email={!linkedin} onArchive={() => void patch({ archived: true }, "Archived")} onDelete={() => { if (confirm("Delete this conversation from your Linki inbox? It stays on LinkedIn / in your mailbox.")) void patch({ deleted: true }, "Conversation deleted"); }} />
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6">
        {linkedin && t.url && (
          <div className="flex justify-center">
            <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-1 text-[13px] text-base-content/60 hover:bg-base-200 disabled:opacity-60">
              {loadingOlder && <RiLoader4Line size={14} className="animate-spin" />} Load earlier messages
            </button>
          </div>
        )}
        {data.messages.map((m) => {
          const out = m.direction === "out";
          if (!linkedin) {
            return (
              <div key={m.id} className="wizard-rise">
                <div className="mb-1.5 flex items-center gap-2 pl-1 text-[14px] text-base-content/60"><span className="font-medium text-base-content/80">{out ? "You" : m.sender_name ?? m.sender_email}</span>{m.sender_email && !out && <span className="truncate">{m.sender_email}</span>}<span>· {ago(m.sent_at)}</span></div>
                <div className={`rounded-[14px] border px-6 py-5 ${out ? "border-[#e5e1fb] bg-[#f6f4ff]" : "border-[var(--border-subtle)] bg-base-100"}`}><EmailBody html={m.body_html} text={m.body_text} /></div>
              </div>
            );
          }
          return (
            <div key={m.id} className={`wizard-rise flex items-end gap-3 ${out ? "justify-end" : ""}`}>
              {!out && <PersonAvatar name={m.sender_name ?? t.participant_name} photo={t.participant_photo} size={34} />}
              <div className={`max-w-[72%] ${out ? "items-end" : ""} flex flex-col`}>
                <div className={`mb-1 text-[13px] text-base-content/50 ${out ? "text-right" : ""}`}>{out ? "You" : m.sender_name} · {ago(m.sent_at)}</div>
                <div className={`whitespace-pre-wrap rounded-[16px] px-4 py-3 text-[15px] leading-relaxed ${out ? "rounded-br-[4px] bg-[#5b4fd6] text-white" : "rounded-bl-[4px] bg-primary/[0.08]"}`}>{m.body_text}</div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>

      <div className="border-t border-[var(--border-subtle)] px-6 py-4">
        <div className="rounded-[14px] border border-[var(--border-strong)] bg-base-100 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-[var(--ring)]">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} placeholder={linkedin ? "Type a message..." : `Reply to ${t.participant_email ?? "this email"}...`}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }}
            className="block w-full resize-none rounded-[14px] bg-transparent px-4 pt-3 text-[15px] outline-none placeholder:text-base-content/40" aria-label="Reply" />
          <div className="flex items-center justify-between px-3 pb-2.5">
            <span className="flex items-center gap-1.5 text-[12px] text-base-content/40">{linkedin ? <RiLinkedinBoxFill size={14} /> : <RiMailLine size={14} />} <kbd className="rounded border border-[var(--border-subtle)] px-1.5">Ctrl</kbd> + <kbd className="rounded border border-[var(--border-subtle)] px-1.5">Enter</kbd> to send</span>
            <button type="button" onClick={() => void send()} disabled={!draft.trim() || sending}
              className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-primary px-4 text-[14px] font-medium text-primary-content hover:bg-[var(--primary-hover)] disabled:bg-base-200 disabled:text-base-content/35">
              {sending ? <RiLoader4Line size={16} className="animate-spin" /> : <RiSendPlane2Line size={16} />} {linkedin ? "Send" : "Send reply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
