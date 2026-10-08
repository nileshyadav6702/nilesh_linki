import type { Engager } from "@/lib/linkedin/engagers";

/** How many reactions one "Post likers" import reads (one Voyager request). */
export const POST_ENGAGER_LIMIT = 100;

/**
 * Read a post's engagers with one LinkedIn account, from a web request. Takes the account the
 * way a runner unit does (withAccountSession → in-process claim + cross-process lease), so it
 * never drives the session alongside the worker: a busy account throws AccountBusyError (→ 409).
 */
export async function fetchPostEngagersWithAccount(accountId: string, activityUrn: string): Promise<Engager[]> {
  const { withAccountSession } = await import("@/lib/linkedin/account-session");
  const { getSessionContext, saveSessionState } = await import("@/lib/linkedin/session");
  const { VoyagerClient } = await import("@/lib/linkedin/voyager");
  const { fetchPostEngagers } = await import("@/lib/linkedin/engagers");
  return withAccountSession(accountId, async () => {
    const client = new VoyagerClient(await getSessionContext(accountId), accountId);
    try {
      return await fetchPostEngagers(client, activityUrn, { reactions: POST_ENGAGER_LIMIT });
    } finally {
      await client.close();
      await saveSessionState(accountId).catch(() => {});
    }
  });
}
