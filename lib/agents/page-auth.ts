import type { GetServerSideProps } from "next";
import { getServerWorkspace, loginRedirect } from "@/lib/server-workspace";

/** SSR gate for the client-rendered AI SDR pages: signed-in workspace members only. */
export const requireSignedIn: GetServerSideProps = async ({ req, res }) => {
  const workspace = await getServerWorkspace(req, res);
  if (!workspace) return loginRedirect(req);
  return { props: {} };
};
