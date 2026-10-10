/** One entry in the notification bell. `alert` = needs the user (stays until resolved). */
export interface FeedItem {
  id: string;
  kind: "alert" | "approval" | "campaign" | "reply" | "activity";
  /** alert = something is blocked; good = a win (reply, acceptance, meeting); info = everything else. */
  tone: "alert" | "good" | "info";
  title: string;
  text: string | null;
  href: string;
  at: string | null;
  photo?: string | null;
}
