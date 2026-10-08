import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests for non-LinkedIn logic only. No test launches a browser or performs
// a live LinkedIn/email/CRM call. Tests that need a database run against a
// throwaway SQLite file (see tests/setup.ts).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // A test's first import of the runner/inbox modules plus fresh-DB migrations takes ~2-4s
    // on its own; under full-suite load that crossed the 5s default and flaked.
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
