import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { RiCompass3Line, RiEyeLine, RiHeart3Line, RiLoader4Line, RiSearchLine, RiUser3Line } from "react-icons/ri";
import { primaryBtn } from "@/components/agents/ui";
import { Modal, SoonPill } from "@/components/agents/sources/kit";
import { isFlagshipSearchUrl } from "@/lib/agents/lookalike-rules";
import { AccountField, accountConnected, FormField, ListField, textCls, type AccountRow } from "@/components/agents/sources/LinkedInFields";
import type { ListRow } from "@/components/agents/sources/SavedListPanel";
import { isSalesNavUrl, normalizeProfileUrlStrict, postActivityId } from "@/lib/agents/lead-source-rules";

type Kind = "search" | "post" | "salesnav" | "visitors" | "profile";

const MENU: Array<{ id: Kind; icon: ReactNode; tint: string; title: string; sub: string; soon?: boolean }> = [
  { id: "search", icon: <RiSearchLine size={22} />, tint: "bg-[#e8f1fb] text-[#0a66c2]", title: "Search", sub: "Import from LinkedIn search." },
  { id: "post", icon: <RiHeart3Line size={22} />, tint: "bg-[#fde8f1] text-[#db2777]", title: "Post Likers & Commenters", sub: "Capture everyone who reacted on a post." },
  { id: "salesnav", icon: <RiCompass3Line size={22} />, tint: "bg-[#fdf3d8] text-[#d97706]", title: "SalesNav", sub: "Capture filtered results from Sales Navigator." },
  { id: "visitors", icon: <RiEyeLine size={22} />, tint: "bg-[#efe8fd] text-[#7c3aed]", title: "Profile visitors", sub: "Import people who visited your LinkedIn profile." },
  { id: "profile", icon: <RiUser3Line size={22} />, tint: "bg-[#e3f5ea] text-[#16a34a]", title: "Import single profile", sub: "Import one LinkedIn profile by URL." },
];

async function post(agentId: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const r = await fetch(`/api/agents/${agentId}/linkedin-import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({ error: "Unexpected server response" }));
  return { ok: r.ok, data };
}

// A div, not a <p>: the design system's unlayered p { margin: 0 } would cancel mx-auto.
const Intro = ({ children }: { children: ReactNode }) => <div className="mx-auto max-w-[620px] text-center text-[17px] text-base-content/55">{children}</div>;
const Submit = ({ busy, disabled, children }: { busy: boolean; disabled: boolean; children: ReactNode }) => (
  <div className="flex justify-end pt-2"><button type="submit" className={primaryBtn} disabled={disabled || busy}>{busy ? <><RiLoader4Line size={16} className="animate-spin" /> Working…</> : children}</button></div>
);

/** "Import leads from LinkedIn": Sales Navigator, post reactors or one profile into a list attached to the agent. */
export default function LinkedInImportModal({ agentId, lists, onListsChanged, onClose, onImported }: {
  agentId: string; lists: ListRow[]; onListsChanged: () => void; onClose: () => void;
  /** Called after a successful import with the list the leads went into. */
  onImported: (into: { listId: string; listName: string }) => void;
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
  // LinkedIn search
  const [searchUrl, setSearchUrl] = useState("");
  const [searchCount, setSearchCount] = useState("50");

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
      const into = String(body.list_id ?? "");
      onImported({ listId: into, listName: allLists.find((l) => l.id === into)?.name ?? "your list" });
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

  const searchOk = isFlagshipSearchUrl(searchUrl.trim());
  const sn = Number(searchCount);
  const searchCountOk = Number.isInteger(sn) && sn >= 1 && sn <= 100;
  const imported = (d: Record<string, unknown>) => `Imported ${d.imported} new lead${d.imported === 1 ? "" : "s"} into "${listName}"${d.existing ? ` (${d.existing} already in your workspace)` : ""}.`;

  let body: ReactNode;
  if (kind === "search") {
    body = (
      <form onSubmit={(e) => { e.preventDefault(); void run({ kind: "search", url: searchUrl.trim(), count: sn, account_id: accountId, list_id: listId }, imported); }} className="space-y-6">
        <Intro>Run a people search on LinkedIn, copy the URL from your browser, then choose the account and lead list for this import.</Intro>
        <FormField label="LinkedIn search URL" required error={searchUrl.trim() && !searchOk ? "Use a people search URL: linkedin.com/search/results/people/?keywords=…" : null}>
          <input className={textCls} value={searchUrl} onChange={(e) => setSearchUrl(e.target.value)} placeholder="https://www.linkedin.com/search/results/people/?keywords=…" aria-label="LinkedIn search URL" />
        </FormField>
        <FormField label="Number of leads to import" required hint="Choose between 1 and 100 leads (10 per results page)." error={searchCount && !searchCountOk ? "Choose between 1 and 100 leads." : null}>
          <input className={textCls} type="number" min={1} max={100} value={searchCount} onChange={(e) => setSearchCount(e.target.value)} aria-label="Number of leads to import" />
        </FormField>
        {accountField("Each results page uses the account's daily LinkedIn budget.")}
        {listField}
        <Submit busy={busy} disabled={!searchOk || !searchCountOk || !accountOk || !listId}>Import search results</Submit>
      </form>
    );
  } else if (kind === "visitors") {
    body = (
      <form onSubmit={(e) => { e.preventDefault(); void run({ kind: "visitors", account_id: accountId, list_id: listId }, imported); }} className="space-y-6">
        <Intro>Import the people LinkedIn lists under &quot;Who viewed your profile&quot; for the account you choose.</Intro>
        <p className="rounded-[10px] bg-base-200/70 px-4 py-3 text-[15.5px] text-base-content/65">LinkedIn shows the full list of profile visitors only on Premium accounts. Anonymous visitors (&quot;LinkedIn Member&quot;) can&apos;t be imported.</p>
        {accountField("The account whose profile visitors to import.")}
        {listField}
        <Submit busy={busy} disabled={!accountOk || !listId}>Import profile visitors</Submit>
      </form>
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
          <h3 className="text-[21px] font-medium text-base-content">Import reactors from a LinkedIn post</h3>
          <p className="text-[16.5px] text-base-content/55">Paste the URL of a LinkedIn post and choose which audiences to import as leads.</p>
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
                  <span className="flex-1 text-[16.5px] text-base-content">People who reacted</span>
                  <span className="text-[16.5px] tabular-nums text-base-content/60">{preview.reactions}{preview.reactions >= 100 ? "+" : ""}</span>
                </label>
                <label className="flex cursor-not-allowed items-center gap-3 px-4 py-3 opacity-60">
                  <input type="checkbox" className="checkbox checkbox-sm rounded-[5px]" disabled checked={false} onChange={() => {}} />
                  <span className="flex-1"><span className="block text-[16.5px] text-base-content">Commenters</span><span className="block text-[15.5px] text-base-content/55">LinkedIn no longer lists commenters separately; most commenters also react.</span></span>
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
        <nav aria-label="LinkedIn import sources" className="shrink-0 space-y-1 border-b border-[var(--border-subtle)] bg-base-200/35 p-4 md:w-[380px] md:border-b-0 md:border-r">
          {MENU.map((m) => {
            const on = m.id === kind;
            return (
              <button key={m.id} type="button" onClick={() => { setKind(m.id); setPreview(null); }} aria-current={on ? "true" : undefined}
                className={`flex w-full items-center gap-4 rounded-[12px] border px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${on ? "border-primary/35 bg-base-100 shadow-[0_1px_2px_rgba(20,20,19,0.06)]" : "border-transparent hover:bg-base-200/60"}`}>
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] ${m.tint}`} aria-hidden="true">{m.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[17.5px] text-base-content">{m.title}{m.soon && <SoonPill />}</span>
                  <span className="block truncate text-[15.5px] text-base-content/50">{m.sub}</span>
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
