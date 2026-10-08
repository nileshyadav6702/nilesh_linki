#!/usr/bin/env node
/*
 * scripts/build-worker.mjs — bundles the background worker (lib/worker/entry.ts) into
 * .worker-dist/worker.js. Runs as part of `npm run build`; `npm run worker` starts the result.
 *
 * Only the app's own code is bundled (the "@/..." alias resolves through tsconfig.json paths).
 * Every npm package stays external and is required from node_modules at runtime, so native and
 * optional dependencies (better-sqlite3, playwright, playwright-extra,
 * puppeteer-extra-plugin-stealth, imap, mailparser, nodemailer, ...) load exactly as they do
 * under Next.js.
 */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = await build({
  absWorkingDir: root,
  entryPoints: ["lib/worker/entry.ts"],
  outfile: ".worker-dist/worker.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
  sourcemap: true,
  logLevel: "warning",
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`[build-worker] .worker-dist/worker.js (${Math.round(bytes / 1024)} KB with sourcemap)`);
