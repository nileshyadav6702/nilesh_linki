import type { GetServerSideProps } from "next";

// Agent creation moved to the 5-step wizard at /agents/new.
export const getServerSideProps: GetServerSideProps = async () => ({ redirect: { destination: "/agents/new", permanent: false } });

export default function Onboarding() { return null; }
