import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { RiLoader4Line } from "react-icons/ri";
import { primaryBtn } from "@/components/agents/ui";
import { Modal, SoonPill } from "@/components/agents/sources/kit";
import { AccountField, accountConnected, FormField, ListField, textCls, type AccountRow } from "@/components/agents/sources/LinkedInFields";
import type { ListRow } from "@/components/agents/sources/SavedListPanel";
import { isSalesNavUrl, normalizeProfileUrlStrict, postActivityId } from "@/lib/agents/lead-source-rules";

type Kind = "search" | "post" | "salesnav" | "visitors" | "profile";

const MENU: Array<{ id: Kind; emoji: string; title: string; sub: string; soon?: boolean }> = [
  { id: "search", emoji: "🔍", title: "Search", sub: "Import from LinkedIn search.", soon: true },
  { id: "post", emoji: "❤️", title: "Post Likers & Commenters", sub: "Capture everyone who reacted on a post." },
  { id: "salesnav", emoji: "🧭", title: "SalesNav", sub: "Capture filtered results from Sales Navigator." },
  { id: "visitors", emoji: "👀", title: "Profile visitors", sub: "Import people who visited your LinkedIn profile.", soon: true },
  { id: "profile", emoji: "👤", title: "Import single profile", sub: "Import one LinkedIn profile by URL." },
];

async function post(agentId: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const r = await fetch(`/api/agents/${agentId}/linkedin-import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({ error: "Unexpected server response" }));
  return { ok: r.ok, data };
}

const Intro = ({ children }: { children: ReactNode }) => <p className="mx-auto max-w-[620px] text-center text-[16px] text-base-content/55">{children}</p>;
const Submit = ({ busy, disabled, children }: { busy: boolean; disabled: boolean; children: ReactNode }) => (
  <div className="flex justify-end pt-2"><button type="submit" className={primaryBtn} disabled={disabled || busy}>{busy ? <><RiLoader4Line size={16} className="animate-spin" /> Working…</> : children}</button></div>
);

/** "Import leads from LinkedIn": Sales Navigator, post reactors or one profile into a list attached to the agent. */
export default function LinkedInImportModal({ agentId, lists, onListsChanged, onClose, onImported }: {
  agentId: string; lists: ListRow[]; onListsChanged: () => void; onClose: () => void; onImported: () => void;
}) {
  const [kind, setKind] = useState<Kind>("salesnav");
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [extra, setExtra] = useState<ListRow[]>([]);
  const [listId, setListId] = useState("");
  const [busy, setBusy] = useState(false);
  // Sales Navigator
  const [navUrl, setNavUrl] = useState("");
  const [count, setCount] = useState("100");
  // Post likers
  const [postUrl, setPostUrl] = useState("");
  const [preview, setPreview] = useState<{ url: string; reactions: number; comments: number } | null>(null);
  const [reactions, setReactions] = useState(true);
  // Single profile
  const [profileUrl, setProfileUrl] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/accounts").then((r) => (r.ok ? r.json() : [])).then((rows: AccountRow[]) => {
      if (!alive) return;
      setAccounts(rows);
      setAccountId((cur) => cur || (rows.find((a) => a.is_authenticated) ?? rows[0])?.id || "");
    }).catch(() => {}).finally(() => { if (alive) setAccountsLoading(false); });
    return () => { alive = false; };
  }, []);

  const allLists = [...extra.filter((e) => !lists.some((l) => l.id === e.id)), ...lists];
  const account = accounts.find((a) => a.id === accountId);
  const accountOk = accountConnected(account);
  const listName = allLists.find((l) => l.id === listId)?.name ?? "the list";
  const created = (l: ListRow) => { setExtra((x) => [l, ...x]); onListsChanged(); };

  async function run(body: Record<string, unknown>, success: (d: Record<string, unknown>) => string) {
    setBusy(true);
    try {
      const { ok, data } = await post(agentId, body);
      if (!ok) { toast.error(String(data.error ?? "Import failed")); return; }
      toast.success(success(data));
      onImported();
      onClose();
    } catch { toast.error("Import failed. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  const n = Number(count);
  const countOk = Number.isInteger(n) && n >= 1 && n <= 2000;
  const navOk = isSalesNavUrl(navUrl);
  function submitNav(e: FormEvent) {
    e.preventDefault();
    void run({ kind: "sales_nav", url: navUrl.trim(), count: n, account_id: accountId, list_id: listId },
      () => `Import queued: up to ${n} leads will be added to "${listName}" in the background, paced to keep the account safe.`);
  }

  const postOk = !!postActivityId(postUrl);
  async function getPost(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { ok, data } = await post(agentId, { kind: "post_preview", post_url: postUrl.trim(), account_id: accountId });
      if (!ok) { toast.error(String(data.error ?? "Could not read this post")); return; }
      setPreview({ url: postUrl.trim(), reactions: Number(data.reactions ?? 0), comments: Number(data.comments ?? 0) });
    } catch { toast.error("Could not read this post"); }
    finally { setBusy(false); }
  }
  function submitPost(e: FormEvent) {
    e.preventDefault();
    void run({ kind: "post", post_url: preview!.url, account_id: accountId, list_id: listId, reactions },
      (d) => `Imported ${d.imported} new lead${d.imported === 1 ? "" : "s"} into "${listName}"${d.existing ? ` (${d.existing} already in your workspace)` : ""}.`);
  }

  const profileOk = !!normalizeProfileUrlStrict(profileUrl);
  function submitProfile(e: FormEvent) {
    e.preventDefault();
    void run({ kind: "profile", profile_url: profileUrl.trim(), list_id: listId },
      (d) => d.created ? `Profile added to "${listName}".` : `This person was already in your workspace. Added to "${listName}".`);
  }

  const accountField = (hint?: string) => <AccountField accounts={accounts} loading={accountsLoading} value={accountId} onChange={(id) => { setAccountId(id); setPreview(null); }} hint={hint} />;
  const listField = <ListField lists={allLists} value={listId} onChange={setListId} onCreated={created} />;

  let body: ReactNode;
  if (kind === "search" || kind === "visitors") {
    body = (
      <div className="space-y-5">
        <Intro>{kind === "search" ? "Import people from a regular LinkedIn search URL." : "Import people who viewed your LinkedIn profile."}</Intro>
        <div className="flex flex-col items-center gap-3 rounded-[12px] bg-base-200/60 px-6 py-8 text-center">
          <SoonPill />
          <p className="max-w-[460px] text-sm text-base-content/65">
            {kind === "search"
              ? "Regular LinkedIn search imports aren't available yet. Run the same search in Sales Navigator and use the SalesNav import instead."
              : "Profile visitor imports aren't available yet."}
          </p>
          {kind === "search" && <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setKind("salesnav")}>Use SalesNav import</button>}
        </div>
      </div>
    );
  } else if (kind === "salesnav") {
    body = (
      <form onSubmit={submitNav} className="space-y-6">
        <Intro>Paste your Sales Navigator list or search URL, then choose the LinkedIn account and lead list for this import.</Intro>
        <FormField label="Sales Navigator link" required error={navUrl.trim() && !navOk ? "Use a Sales Navigator lead list (/sales/lists/people/…), saved search (?savedSearchId=…) or people search URL." : null}>
          <input className={textCls} value={navUrl} onChange={(e) => setNavUrl(e.target.value)} placeholder="https://www.linkedin.com/sales/search/people?…" aria-label="Sales Navigator link" />
        </FormField>
        <FormField label="Number of leads to import" required hint="Choose between 1 and 2000 leads." error={count && !countOk ? "Choose between 1 and 2000 leads." : null}>
          <input className={textCls} type="number" min={1} max={2000} value={count} onChange={(e) => setCount(e.target.value)} aria-label="Number of leads to import" />
        </FormField>
        {accountField("Use the Sales Navigator account that created the link.")}
        {listField}
        <Submit busy={busy} disabled={!navOk || !countOk || !accountOk || !listId}>Import SalesNav leads</Submit>
      </form>
    );
  } else if (kind === "post") {
    body = (
      <form onSubmit={preview ? submitPost : getPost} className="space-y-6">
        <div className="space-y-1 text-center">
          <h3 className="text-[19px] font-medium text-base-content">Import reactors from a LinkedIn post</h3>
          <p className="text-[15px] text-base-content/55">Paste the URL of a LinkedIn post and choose which audiences to import as leads.</p>
        </div>
        {accountField("The account that reads the post. Reading uses its daily LinkedIn budget.")}
        <FormField label="Post URL" required error={postUrl.trim() && !postOk ? "Paste a post URL — it contains \"activity\" (Copy link to post on LinkedIn)." : null}>
          <input className={textCls} value={postUrl} onChange={(e) => { setPostUrl(e.target.value); setPreview(null); }} placeholder="https://www.linkedin.com/posts/…" aria-label="Post URL" />
        </FormField>
        {!preview ? (
          <button type="submit" disabled={!postOk || !accountOk || busy} className={`${primaryBtn} h-12 w-full`}>{busy ? <><RiLoader4Line size={16} className="animate-spin" /> Reading post…</> : "Get post"}</button>
        ) : (
          <>
            <FormField label="Audiences to import">
              <div className="rounded-[12px] border border-[var(--border-subtle)]">
                <label className="flex cursor-pointer items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
                  <input type="checkbox" className="checkbox checkbox-sm checkbox-primary rounded-[5px]" checked={reactions} onChange={(e) => setReactions(e.target.checked)} />
                  <span className="flex-1 text-[15px] text-base-content">People who reacted</span>
                  <span className="text-sm tabular-nums text-base-content/60">{preview.reactions}{preview.reactions >= 100 ? "+" : ""}</span>
                </label>
                <label className="flex cursor-not-allowed items-center gap-3 px-4 py-3 opacity-60">
                  <input type="checkbox" className="checkbox checkbox-sm rounded-[5px]" disabled checked={false} onChange={() => {}} />
                  <span className="flex-1"><span className="block text-[15px] text-base-content">Commenters</span><span className="block text-[13px] text-base-content/55">LinkedIn no longer lists commenters separately; most commenters also react.</span></span>
                  <SoonPill />
                </label>
              </div>
            </FormField>
            {listField}
            <Submit busy={busy} disabled={!reactions || !preview.reactions || !accountOk || !listId}>Import {preview.reactions} reactor{preview.reactions === 1 ? "" : "s"}</Submit>
          </>
        )}
      </form>
    );
  } else {
    body = (
      <form onSubmit={submitProfile} className="space-y-6">
        <Intro>Paste a LinkedIn profile URL, then choose the lead list for this import.</Intro>
        <FormField label="LinkedIn profile URL" required error={profileUrl.trim() && !profileOk ? "Paste a LinkedIn profile URL (linkedin.com/in/…)." : null}
          hint="The name is taken from the profile URL; you can edit the contact afterwards.">
          <input className={textCls} value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} placeholder="https://www.linkedin.com/in/jane-doe/" aria-label="LinkedIn profile URL" />
        </FormField>
        {listField}
        <Submit busy={busy} disabled={!profileOk || !listId}>Import profile</Submit>
      </form>
    );
  }

  return (
    <Modal labelId="linkedin-import-title" title="Import leads from LinkedIn" subtitle="Pick the source you want to import from LinkedIn." onClose={() => { if (!busy) onClose(); }}>
      <div className="flex min-h-[560px] flex-col md:flex-row">
        <nav aria-label="LinkedIn import sources" className="shrink-0 space-y-1 border-b border-[var(--border-subtle)] p-4 md:w-[340px] md:border-b-0 md:border-r">
          {MENU.map((m) => {
            const on = m.id === kind;
            return (
              <button key={m.id} type="button" onClick={() => { setKind(m.id); setPreview(null); }} aria-current={on ? "true" : undefined}
                className={`flex w-full items-center gap-4 rounded-[12px] px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${on ? "bg-primary/10" : "hover:bg-base-200/60"}`}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center text-[24px] leading-none" aria-hidden="true">{m.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className={`flex items-center gap-2 text-[16px] ${on ? "text-primary" : "text-base-content"}`}>{m.title}{m.soon && <SoonPill />}</span>
                  <span className="block truncate text-[14px] text-base-content/50">{m.sub}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1 px-5 py-8 sm:px-10"><div className="mx-auto max-w-[700px]">{body}</div></div>
      </div>
    </Modal>
  );
}
