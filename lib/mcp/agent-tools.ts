import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpScope } from "@/lib/mcp/auth";

type ApiOptions = { method?: string; query?: Record<string, string | number | boolean | undefined>; body?: unknown };
type Api = (path: string, options?: ApiOptions) => Promise<unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Run = (name: string, scope: McpScope, args: unknown, work: () => Promise<unknown>) => Promise<any>;

const enc = encodeURIComponent;
const SOURCE = z.enum(["competitor_engagement", "influencer_engagement", "own_content_engagement", "keyword_engagement", "job_change", "hiring", "funding", "lookalike"]);

/** MCP tools for the AI SDR layer: ICP, agents, signal sources, leads and approvals. */
export function registerAgentTools(server: McpServer, api: Api, run: Run) {
  server.registerTool("icp_get", {
    title: "Get ideal customer profile", description: "Read the workspace's current ICP (offer, personas, competitors, keywords) and its version history.",
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => run("icp_get", "mcp:read", {}, () => api("/api/icp")));

  server.registerTool("icp_draft_from_website", {
    title: "Draft ICP from a website", description: "Read a company website and draft an ICP. Does not save it — call icp_save after review.",
    inputSchema: { website_url: z.string().min(3) }, annotations: { readOnlyHint: true, openWorldHint: true },
  }, (args) => run("icp_draft_from_website", "mcp:read", args, () => api("/api/icp/draft", { method: "POST", body: args })));

  server.registerTool("icp_save", {
    title: "Save ICP", description: "Save an ICP as a new immutable version (shape as returned by icp_get / icp_draft_from_website).",
    inputSchema: { data: z.record(z.string(), z.unknown()), website_url: z.string().optional() }, annotations: { destructiveHint: false, openWorldHint: false },
  }, (args) => run("icp_save", "mcp:write", args, () => api("/api/icp", { method: "POST", body: args })));

  server.registerTool("agents_list", {
    title: "List AI agents", description: "List AI SDR agents with status, mode, signal sources and today's discovered/qualified/contacted counts.",
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => run("agents_list", "mcp:read", {}, () => api("/api/agents")));

  server.registerTool("agent_get", {
    title: "Get AI agent", description: "Read one agent: settings, sources, detector runs, per-signal funnel and LinkedIn discovery budget.",
    inputSchema: { agent_id: z.string() }, annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ agent_id }) => run("agent_get", "mcp:read", { agent_id }, () => api(`/api/agents/${enc(agent_id)}`)));

  server.registerTool("agent_create", {
    title: "Create AI agent", description: "Create an AI SDR agent (as a draft). Without workflow_id, set create_default_campaign=true for a ready-made campaign. Activate with agent_update status=active after the user confirms.",
    inputSchema: {
      name: z.string().min(1), icp_id: z.string().optional(), mode: z.enum(["copilot", "autopilot"]).default("copilot"),
      min_score: z.number().min(0).max(100).optional(), daily_lead_cap: z.number().int().min(1).max(500).optional(),
      workflow_id: z.string().optional(), create_default_campaign: z.boolean().optional(),
      linkedin_account_id: z.string().optional(), email_account_id: z.string().optional(), booking_url: z.string().url().optional(),
      sources: z.array(z.object({ source_type: SOURCE, config: z.record(z.string(), z.unknown()).optional(), interval_hours: z.number().optional() })).optional(),
    },
    annotations: { destructiveHint: false, openWorldHint: false },
  }, (args) => run("agent_create", "mcp:write", args, () => api("/api/agents", { method: "POST", body: args })));

  server.registerTool("agent_update", {
    title: "Update AI agent", description: "Change agent settings or status (active starts discovery and outreach; paused stops both).",
    inputSchema: {
      agent_id: z.string(), status: z.enum(["active", "paused"]).optional(), mode: z.enum(["copilot", "autopilot"]).optional(),
      min_score: z.number().min(0).max(100).optional(), daily_lead_cap: z.number().int().min(1).max(500).optional(), icp_id: z.string().optional(),
      workflow_id: z.string().optional(), linkedin_account_id: z.string().optional(), email_account_id: z.string().optional(), booking_url: z.string().url().optional(),
    },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ agent_id, ...body }) => run("agent_update", "mcp:execute", { agent_id, ...body }, () => api(`/api/agents/${enc(agent_id)}`, { method: "PATCH", body })));

  server.registerTool("agent_source_add", {
    title: "Add signal source", description: "Add a buying-signal source to an agent, e.g. competitor_engagement with config.urls of LinkedIn company pages, keyword_engagement with config.keywords, hiring with config.boards [{ats,slug}].",
    inputSchema: { agent_id: z.string(), source_type: SOURCE, config: z.record(z.string(), z.unknown()).default({}), interval_hours: z.number().min(1).max(168).optional() },
    annotations: { destructiveHint: false, openWorldHint: false },
  }, ({ agent_id, ...body }) => run("agent_source_add", "mcp:write", { agent_id, ...body }, () => api(`/api/agents/${enc(agent_id)}/sources`, { method: "POST", body })));

  server.registerTool("agent_run_now", {
    title: "Run agent now", description: "Run non-LinkedIn sources immediately, queue LinkedIn sources for the next discovery pass, then score and draft.",
    inputSchema: { agent_id: z.string() }, annotations: { openWorldHint: true },
  }, ({ agent_id }) => run("agent_run_now", "mcp:execute", { agent_id }, () => api(`/api/agents/${enc(agent_id)}/run`, { method: "POST" })));

  server.registerTool("leads_list", {
    title: "List agent leads", description: "The leads feed: agent-sourced contacts ranked by lead score with signals (why now), fit reasoning and pending drafts.",
    inputSchema: {
      agent_id: z.string().optional(), status: z.enum(["new", "qualified", "disqualified", "drafted", "approved", "enrolled", "skipped", "all"]).optional(),
      signal_type: z.string().optional(), verdict: z.enum(["strong", "possible", "poor"]).optional(), q: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(25), offset: z.number().int().min(0).default(0),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (args) => run("leads_list", "mcp:read", args, () => api("/api/leads", { query: args })));

  server.registerTool("lead_action", {
    title: "Act on a lead", description: "enroll (add to the agent's campaign), skip (with reason), requalify (re-score), or find_email (email waterfall).",
    inputSchema: { contact_id: z.string(), action: z.enum(["enroll", "skip", "requalify", "find_email"]), reason: z.string().optional() },
    annotations: { openWorldHint: true },
  }, ({ contact_id, ...body }) => run("lead_action", "mcp:execute", { contact_id, ...body }, () => api(`/api/leads/${enc(contact_id)}`, { method: "PATCH", body })));

  server.registerTool("approvals_list", {
    title: "List drafts awaiting approval", description: "First-touch drafts agents want to send, with the lead, its signal and the agent.",
    inputSchema: { agent_id: z.string().optional() }, annotations: { readOnlyHint: true, openWorldHint: false },
  }, (args) => run("approvals_list", "mcp:read", args, () => api("/api/approvals", { query: args })));

  server.registerTool("approval_decide", {
    title: "Approve or reject a draft", description: "Approve (optionally with edited subject/body) or reject a draft. Approving enrolls the lead in the agent's campaign, which will send it.",
    inputSchema: { draft_id: z.string(), decision: z.enum(["approve", "reject"]), subject: z.string().optional(), body: z.string().optional() },
    annotations: { destructiveHint: false, openWorldHint: true },
  }, ({ draft_id, ...body }) => run("approval_decide", "mcp:execute", { draft_id, ...body }, () => api(`/api/approvals/${enc(draft_id)}`, { method: "PATCH", body })));

  server.registerTool("inbox_reply_draft", {
    title: "Draft a reply with AI", description: "Draft an answer to an inbound email reply (offers the agent's meeting link to interested prospects). Never sends.",
    inputSchema: { reply_id: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, ({ reply_id }) => run("inbox_reply_draft", "mcp:write", { reply_id }, () => api(`/api/inbox/${enc(reply_id)}/draft`, { method: "POST" })));
}
