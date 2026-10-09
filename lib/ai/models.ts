import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";

/**
 * Which key and model every AI call uses. The key comes from OPENROUTER_API_KEY (falling back
 * to a key saved on the workspace before the env key existed). The model is picked per task,
 * so users never choose one:
 *
 *  - "fast": extraction, scoring and classification. Short JSON output, called often, so cost
 *    dominates: Gemini 2.5 Flash is cheap, quick and reliable at structured output.
 *  - "write": anything a prospect reads (connection notes, messages, emails, reply drafts).
 *    Quality and tone matter, volume is lower: Claude Haiku 4.5 writes natural, on-brief copy
 *    at a fraction of a frontier model's price.
 *
 * Both can be overridden with AI_MODEL_FAST / AI_MODEL_WRITE (OpenRouter model ids).
 */

export type ModelTier = "fast" | "write";

export const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: "google/gemini-2.5-flash",
  write: "anthropic/claude-haiku-4.5",
};

const WRITE_PURPOSES = new Set(["first_touch", "sequence_write", "reply_draft", "template_preview", "message", "email", "inmail"]);

/** The tier for a task: writing prospects read → "write", everything else → "fast". */
export function tierFor(purpose: string): ModelTier {
  return WRITE_PURPOSES.has(purpose) ? "write" : "fast";
}

export function modelFor(purpose: string): string {
  const tier = tierFor(purpose);
  const env = tier === "write" ? process.env.AI_MODEL_WRITE : process.env.AI_MODEL_FAST;
  return env?.trim() || DEFAULT_MODELS[tier];
}

/** The OpenRouter key: the server's OPENROUTER_API_KEY, else one saved on the workspace. */
export function aiApiKey(workspaceId: string): string | null {
  const env = process.env.OPENROUTER_API_KEY?.trim();
  if (env) return env;
  const row = getDb().prepare("SELECT api_key FROM integrations WHERE key = 'openrouter' AND workspace_id = ?").get(workspaceId) as { api_key: string | null } | undefined;
  return decryptSecret(row?.api_key ?? null);
}
