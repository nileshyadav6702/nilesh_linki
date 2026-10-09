import Head from "next/head";
import ContactsHeader from "@/components/contacts/ContactsHeader";
import { ContactsWorkspace } from "@/components/contacts/ContactsWorkspace";
import { requireSignedIn } from "@/lib/agents/page-auth";

export const getServerSideProps = requireSignedIn;

/** Contacts: every contact in the workspace (agents, lists and imports) in one filterable table. */
export default function Contacts() {
  return (
    <>
      <Head><title>Contacts — Kairo</title></Head>
      <ContactsHeader tab="contacts" />
      <ContactsWorkspace />
    </>
  );
}
