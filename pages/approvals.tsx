import type { GetServerSideProps } from "next";

// Approvals happen on the lead, inside the agent.
export const getServerSideProps: GetServerSideProps = async () => ({ redirect: { destination: "/agents", permanent: false } });

export default function Approvals() { return null; }
