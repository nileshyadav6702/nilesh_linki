// Public entry point of the campaign runner. The implementation lives in lib/linkedin/campaign/:
//   loops.ts        background loops (LinkedIn, email, inbox, warmup, ...) and boot recovery
//   tick.ts         one LinkedIn campaign pass: syncs, enrollment, daily caps, step execution
//   email-tick.ts   one email campaign pass (no browser)
//   runs.ts         run selection, heartbeat, enrollment spreading, run completion
//   steps/          executeStep and one handler per step type
//   track-state.ts  the only writers of run_profile_tracks state
//   schedule.ts     working-window and email pacing arithmetic
export { ensureGlobalRunnerStarted } from "./campaign/loops";
export { emailCampaignTick } from "./campaign/email-tick";
export { linkedInCampaignRuns, emailCampaignRuns, startRun, type CampaignRunRef } from "./campaign/runs";
