import type { GetServerSideProps } from "next";

// Approvals moved into Copilot, which reviews every step of the sequence per contact.
export const getServerSideProps: GetServerSideProps = async () => ({ redirect: { destination: "/copilot", permanent: false } });

export default function Approvals() { return null; }
