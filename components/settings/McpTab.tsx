import { useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";
import { LuBookOpen, LuCheck, LuCopy, LuServer, LuTerminal } from "react-icons/lu";
import { SideDrawer } from "@/components/agents/campaign/kit";
import { BRAND } from "@/lib/brand";

/** Settings → MCP: connect Claude (or any MCP client) to this workspace through /api/mcp (OAuth sign-in). */

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);
const noop = () => () => {};

const TOOLS: Array<[string, string]> = [
  ["Workspace", "Overview of agents, pipeline and AI usage"],
  ["Contacts & companies", "Search, read, create, update and delete contacts; manage companies"],
  ["Lists & imports", "Create lists, add members, import CSVs and Sales Navigator searches, verify and enrich emails"],
  ["Campaigns", "Read and build workflows, add steps, start, pause and manage runs"],
  ["Inbox", "Read replies and email threads, send an email, mark a contact as replied"],
  ["CRM", "Todos and activities on contacts"],
  ["Senders", "List LinkedIn and email senders and their health"],
];

function CopyButton({ text, label = "Copy", solid = false }: { text: string; label?: string; solid?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = () => navigator.clipboard.writeText(text).then(() => { setDone(true); toast.success("Copied"); setTimeout(() => setDone(false), 1500); }, () => toast.error("Could not copy. Select the text instead."));
  return (
    <button type="button" onClick={() => void copy()} aria-label={`${label} ${text}`}
      className={solid ? "inline-flex h-12 shrink-0 items-center gap-2 rounded-[10px] bg-primary px-5 text-[17px] font-semibold text-primary-content shadow-[0_6px_16px_-8px_var(--color-primary)] hover:bg-[var(--primary-hover)]"
        : "inline-flex h-11 shrink-0 items-center gap-2 rounded-[10px] border border-[var(--border-strong)] px-4 text-[16px] font-medium hover:bg-base-200"}>
      {done ? <LuCheck size={18} /> : <LuCopy size={18} />}{label}
    </button>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-4 text-[18px] leading-relaxed">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[14px] font-semibold text-primary-content">{n}</span>
      <span>{children}</span>
    </li>
  );
}

export default function McpTab() {
  const base = useSyncExternalStore(noop, origin, () => "");
  const url = `${base}/api/mcp`;
  const cli = `claude mcp add --transport http ${BRAND.name.toLowerCase()} ${url}`;
  const [docs, setDocs] = useState(false);
  const link = { color: "#4f2fd0" };

  return (
    <div className="wizard-rise rounded-[16px] border border-[var(--border-subtle)] bg-base-100">
      <div className="border-b border-[var(--border-subtle)] px-8 py-6">
        <div role="heading" aria-level={2} className="text-[24px] font-medium">MCP Server</div>
        <div className="mt-1 text-[17px] text-base-content/70">Connect AI tools like Claude to your {BRAND.name} data via the Model Context Protocol.</div>
      </div>

      <div className="space-y-10 px-8 py-8">
        <section>
          <div className="text-[19px] font-medium">Server URL</div>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-[12px] border border-[var(--border-subtle)] bg-base-200/50 px-5">
              <LuServer size={21} className="shrink-0 text-primary" />
              <code className="truncate font-mono text-[17px]">{url}</code>
            </div>
            <CopyButton text={url} solid />
          </div>
          <div className="mt-2.5 text-[15px] text-base-content/65">
            No key to paste: the first time you connect, you sign in to {BRAND.name} and choose what the AI may do. For scripts and other tools, use a key from the{" "}
            <Link href="/settings?tab=api" className="font-medium" style={link}>API tab</Link>.
          </div>
        </section>

        <section>
          <div className="text-[19px] font-medium">Setup with Claude</div>
          <ol className="mt-4 space-y-3.5">
            <Step n={1}>Open <a href="https://claude.ai" target="_blank" rel="noreferrer" className="font-medium" style={link}>claude.ai</a>, click your profile icon → <b>Settings</b>.</Step>
            <Step n={2}>Navigate to <b>Connectors</b> in the left sidebar.</Step>
            <Step n={3}>Click <b>Add custom connector</b> and paste the server URL above.</Step>
            <Step n={4}>Sign in to <b>{BRAND.name}</b> when prompted and allow access.</Step>
            <Step n={5}>In a conversation, click <b>+</b> → <b>Connectors</b> and toggle <b>{BRAND.name}</b> on.</Step>
          </ol>
        </section>

        <section>
          <div className="flex items-center gap-2.5 text-[19px] font-medium"><LuTerminal size={20} className="text-base-content/60" />Claude Code</div>
          <div className="mt-1 text-[16px] text-base-content/65">Run this in your terminal, then sign in when the browser opens.</div>
          <div className="mt-3 flex items-center gap-3">
            <code className="flex h-12 min-w-0 flex-1 items-center truncate rounded-[10px] bg-[#1f1e1d] px-4 font-mono text-[15px] text-[#f3efe6]">{cli}</code>
            <CopyButton text={cli} />
          </div>
        </section>

        <button type="button" onClick={() => setDocs(true)} className="inline-flex items-center gap-2 text-[17px] font-medium text-primary hover:underline"><LuBookOpen size={20} />Full documentation</button>
      </div>

      {docs && createPortal(
        <SideDrawer title="MCP documentation" icon={<LuBookOpen size={22} />} onClose={() => setDocs(false)} width={720}>
          <div className="space-y-7 pb-6 text-[16px] leading-relaxed text-base-content/75">
            <section>
              <div className="text-[18px] font-semibold text-base-content">How it connects</div>
              <p className="mt-1">The server speaks MCP over Streamable HTTP at <code className="font-mono">{url}</code>. Clients sign in with OAuth: you approve the connection in {BRAND.name}, and the AI acts as you, inside your workspace, with the access you granted. Remove a connector in your AI tool to revoke it.</p>
            </section>
            <section>
              <div className="text-[18px] font-semibold text-base-content">Other clients</div>
              <p className="mt-1">Cursor, Claude Desktop and other MCP clients: add an HTTP (remote) MCP server with the URL above.</p>
            </section>
            <section>
              <div className="text-[18px] font-semibold text-base-content">What the AI can do</div>
              <div className="mt-3 divide-y divide-[var(--border-subtle)] rounded-[12px] border border-[var(--border-subtle)]">
                {TOOLS.map(([k, v]) => <div key={k} className="px-4 py-3"><div className="font-medium text-base-content">{k}</div><div className="text-[15px]">{v}</div></div>)}
              </div>
            </section>
            <section>
              <div className="text-[18px] font-semibold text-base-content">Try asking</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>&ldquo;Which leads replied this week, and what did they say?&rdquo;</li>
                <li>&ldquo;Create a list of the CTOs from my contacts in fintech.&rdquo;</li>
                <li>&ldquo;Pause my campaign that has the most bounces.&rdquo;</li>
              </ul>
            </section>
          </div>
        </SideDrawer>, document.body)}
    </div>
  );
}
