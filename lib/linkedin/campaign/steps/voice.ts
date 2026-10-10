import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getSessionPage } from "@/lib/linkedin/session";
import { sendMessage } from "@/lib/linkedin/message";
import { settledPriorAction } from "@/lib/linkedin/actions";
import { CONNECTION_RECHECK_HOURS } from "../constants";
import { invitationExpired, skipToEmail } from "../invitation-fallback";
import { actionInput, saveSessionAfterSend, sendLinkedinAction, settlePriorLinkedinAction } from "../step-helpers";
import { ensureSalesNavEnriched } from "../pre-enrich";
import { enforceSchedule, log, nowIso, trAdvance, trWait } from "../track-state";
import type { Target } from "../types";
import type { StepContext } from "./context";

const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav" };

/**
 * Voice Message: the step's recording, sent to a 1st-degree connection as an audio file in the
 * LinkedIn chat. LinkedIn's website has no voice-note recorder, so it arrives as a playable
 * audio attachment rather than the mobile app's voice bubble.
 */
export async function runVoiceStep(ctx: StepContext): Promise<void> {
  const { db, runId, tr, target, steps, step, name, accountId, accountLimits } = ctx;
  await ensureSalesNavEnriched(db, target, accountId);
  if (!enforceSchedule(db, tr, runId, target.id, name, accountLimits)) return;

  const freshTarget = db.prepare("SELECT * FROM targets WHERE id = ?").get(target.id) as Target;
  if (freshTarget.degree !== 1) {
    if (invitationExpired(steps, freshTarget.connection_requested_at)) { skipToEmail(db, runId, tr, target.id, name, steps); return; }
    log(db, runId, target.id, "info", `${name} not yet connected — rescheduling voice message in ${CONNECTION_RECHECK_HOURS}h`);
    trWait(db, tr, CONNECTION_RECHECK_HOURS);
    return;
  }

  const media = db.prepare("SELECT mime, data FROM step_media WHERE step_id = ?").get(step.id) as { mime: string; data: Buffer } | undefined;
  if (!media) {
    log(db, runId, target.id, "warn", `Voice step has no recording yet — skipping it for ${name}`);
    trAdvance(db, tr, steps);
    return;
  }
  const voice = actionInput("voice", runId, tr, step, accountId, target.id);
  if (settlePriorLinkedinAction(db, runId, tr, steps, target.id, name, "voice", settledPriorAction(db, voice.key))) return;
  if (!target.full_name) throw new Error(`Target ${target.id} has no full_name — cannot search messaging`);
  const fullName = target.full_name;

  db.prepare("UPDATE run_profile_tracks SET last_step_at = datetime('now') WHERE id = ?").run(tr.id);
  log(db, runId, target.id, "info", `Sending voice message to ${name}`);
  const dir = mkdtempSync(join(tmpdir(), "linki-voice-"));
  const file = join(dir, `voice-message.${EXT[media.mime.split(";")[0]] ?? "webm"}`);
  writeFileSync(file, media.data);
  try {
    const sent = await sendLinkedinAction(db, voice, async () => {
      const page = await getSessionPage(accountId);
      try { await sendMessage(page, { fullName, profileUrl: target.linkedin_url }, "", { attachmentPath: file }); } finally { await page.close(); }
    });
    if (!sent.claimed) { settlePriorLinkedinAction(db, runId, tr, steps, target.id, name, "voice", sent.status); return; }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  await saveSessionAfterSend(accountId);
  db.transaction(() => {
    db.prepare("UPDATE targets SET message_sent_at = COALESCE(message_sent_at, ?) WHERE id = ?").run(nowIso(), target.id);
    trAdvance(db, tr, steps);
    log(db, runId, target.id, "info", `Voice message sent to ${name}`);
  })();
}
