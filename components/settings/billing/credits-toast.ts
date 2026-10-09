import { toast } from "sonner";

/** API failures for paid actions: "not enough credits" gets a link to Settings → Billing. */

export const isCreditsError = (body: unknown) => (body as { code?: string } | null)?.code === "insufficient_credits";

export function failToast(body: { error?: string; code?: string } | null, fallback: string): void {
  if (isCreditsError(body)) toast.error(body?.error ?? "Not enough credits", { action: { label: "View billing", onClick: () => window.location.assign("/settings?tab=billing") } });
  else toast.error(body?.error ?? fallback);
}
