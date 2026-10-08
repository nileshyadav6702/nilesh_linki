// Entrypoint of the background worker process. Bundled to .worker-dist/worker.js by
// scripts/build-worker.mjs (`npm run build`), started with `npm run worker`; in development
// `npm run worker:dev` runs this file directly through tsx. See lib/worker/main.ts.
import { runWorker } from "./main";

runWorker().catch((err) => {
  console.error("[worker] failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
