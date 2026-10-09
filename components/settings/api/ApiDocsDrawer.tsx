import { useState } from "react";
import { toast } from "sonner";
import { LuBookOpen, LuCheck, LuCopy } from "react-icons/lu";
import { SideDrawer } from "@/components/agents/campaign/kit";

/** In-app reference for the public /api/v1 API (the routes in pages/api/v1/[...path].ts). */

const READ: Array<[string, string, string]> = [
  ["GET", "/contacts · /contacts/{id}", "contacts:read"],
  ["GET", "/companies · /lists · /list_members?list_id=", "campaigns:read"],
  ["GET", "/agents · /icps · /approvals", "campaigns:read"],
  ["GET", "/workflows · /runs · /run_profiles?run_id= · /run_profile_tracks?run_id=", "campaigns:read"],
  ["GET", "/sent_messages · /email_accounts", "campaigns:read"],
  ["GET", "/events · /signals · /signal_rules", "events:read"],
  ["GET", "/opportunities · /pipeline_stages", "crm:read"],
  ["GET", "/suppressions", "contacts:read"],
];
const WRITE: Array<[string, string, string]> = [
  ["POST", "/contacts", "contacts:write"],
  ["PATCH", "/contacts/{id}", "contacts:write"],
  ["POST", "/contacts/verify", "contacts:write"],
  ["POST", "/contacts/{id}/send", "email:send"],
  ["POST", "/signals", "signals:write"],
  ["POST", "/events", "events:write"],
  ["POST · PATCH", "/opportunities · /opportunities/{id}", "crm:write"],
];

function Code({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-2 rounded-[10px] bg-[#1f1e1d] px-4 py-3.5 pr-12 font-mono text-[14px] leading-relaxed text-[#f3efe6]">
      <pre className="overflow-x-auto whitespace-pre">{text}</pre>
      <button type="button" aria-label="Copy" onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); toast.success("Copied"); setTimeout(() => setCopied(false), 1500); }); }}
        className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-[6px] text-white/60 hover:bg-white/10 hover:text-white">{copied ? <LuCheck size={16} /> : <LuCopy size={16} />}</button>
    </div>
  );
}

function Table({ rows }: { rows: Array<[string, string, string]> }) {
  return (
    <div className="mt-3 overflow-hidden rounded-[10px] border border-[var(--border-subtle)]">
      {rows.map(([m, path, scope]) => (
        <div key={m + path} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[var(--border-subtle)] px-4 py-3 first:border-t-0">
          <span className="w-[110px] shrink-0 font-mono text-[13px] font-semibold text-[#5b3fd6]">{m}</span>
          <span className="min-w-0 flex-1 break-words font-mono text-[14px]">{path}</span>
          <span className="rounded-full bg-base-200 px-2.5 py-0.5 font-mono text-[12.5px] text-base-content/70">{scope}</span>
        </div>
      ))}
    </div>
  );
}

export default function ApiDocsDrawer({ onClose }: { onClose: () => void }) {
  const base = typeof window === "undefined" ? "/api/v1" : `${window.location.origin}/api/v1`;
  const h = "text-[18px] font-semibold";
  const p = "mt-1 text-[16px] leading-relaxed text-base-content/70";
  return (
    <SideDrawer title="API documentation" icon={<LuBookOpen size={22} />} onClose={onClose} width={760}>
      <div className="space-y-8 pb-6">
        <section>
          <div className={h}>Authentication</div>
          <div className={p}>Send your key as a Bearer token. Each key only reaches this workspace, and only with the scopes it was created with; a missing scope returns <code className="font-mono">403 insufficient_scope</code>.</div>
          <Code text={`curl ${base}/contacts?limit=20 \\\n  -H "Authorization: Bearer YOUR_API_KEY"`} />
        </section>
        <section>
          <div className={h}>Base URL and paging</div>
          <div className={p}>All routes live under <code className="font-mono">{base}</code>. Lists take <code className="font-mono">limit</code> (1–500, default 100) and <code className="font-mono">offset</code>.</div>
        </section>
        <section>
          <div className={h}>Read</div>
          <Table rows={READ} />
        </section>
        <section>
          <div className={h}>Write</div>
          <Table rows={WRITE} />
          <div className={p}>Create a contact:</div>
          <Code text={`curl -X POST ${base}/contacts \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"full_name":"Ada Lovelace","email":"ada@example.com","company":"Analytical Engines"}'`} />
          <div className={p}>Sending email needs the separate <code className="font-mono">email:send</code> scope, and suppressed addresses return <code className="font-mono">409 recipient_suppressed</code>.</div>
        </section>
        <section>
          <div className={h}>Errors</div>
          <div className={p}><code className="font-mono">401 invalid_api_key</code> (missing, wrong or deleted key) · <code className="font-mono">403 insufficient_scope</code> · <code className="font-mono">400</code> with an <code className="font-mono">error</code> message for invalid input · <code className="font-mono">404</code> for an unknown id.</div>
        </section>
      </div>
    </SideDrawer>
  );
}
