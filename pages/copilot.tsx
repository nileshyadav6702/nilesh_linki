import type { GetServerSideProps } from "next";
import { getDb } from "@/lib/db";
import { getServerWorkspace, loginRedirect } from "@/lib/server-workspace";

// Review happens on the lead, inside the agent.
export const getServerSideProps: GetServerSideProps = async ({ query, req, res }) => {
  const workspace = await getServerWorkspace(req, res);
  if (!workspace) return loginRedirect(req);
  const contact = typeof query.contact === "string" ? query.contact : "";
  if (contact) {
    const row = getDb().prepare("SELECT agent_id FROM targets WHERE id = ? AND workspace_id = ?").get(contact, workspace.workspaceId) as { agent_id: string | null } | undefined;
    if (row?.agent_id) return { redirect: { destination: `/agents/${row.agent_id}?tab=Leads&lead=${encodeURIComponent(contact)}`, permanent: false } };
  }
  return { redirect: { destination: "/agents", permanent: false } };
};

export default function CopilotRedirect() { return null; }
