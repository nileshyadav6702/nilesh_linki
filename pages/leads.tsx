import type { GetServerSideProps } from "next";
import { getServerWorkspace, loginRedirect } from "@/lib/server-workspace";

// Leads live on the agent. Old links open that agent's Leads tab.
export const getServerSideProps: GetServerSideProps = async ({ query, req, res }) => {
  const workspace = await getServerWorkspace(req, res);
  if (!workspace) return loginRedirect(req);
  const agentId = typeof query.agent_id === "string" ? query.agent_id : "";
  const lead = typeof query.lead === "string" ? query.lead : "";
  if (agentId) {
    const q = lead ? `?tab=Leads&lead=${encodeURIComponent(lead)}` : "?tab=Leads";
    return { redirect: { destination: `/agents/${agentId}${q}`, permanent: false } };
  }
  return { redirect: { destination: "/agents", permanent: false } };
};

export default function LeadsRedirect() { return null; }
