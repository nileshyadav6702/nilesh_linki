import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import LeadsTable from "@/components/agents/LeadsTable";
import { PageHeader, primaryBtn } from "@/components/agents/ui";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

export default function LeadsPage() {
  const router = useRouter();
  const agentId = typeof router.query.agent_id === "string" ? router.query.agent_id : undefined;
  return (
    <>
      <Head><title>Leads — Linki</title></Head>
      <div className="space-y-6">
        <PageHeader eyebrow="AI SDR" title="Leads" subtitle="People your agents found, ranked by fit and buying intent." actions={<Link href="/copilot" className={primaryBtn}>Open Copilot</Link>} />
        {router.isReady && <LeadsTable key={agentId ?? "all"} initialAgentId={agentId} showAgent />}
      </div>
    </>
  );
}
