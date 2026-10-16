import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "fs";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

// Dedicated port for this project's e2e server. Port 3000 on this machine is
// held by an unrelated project's dev server in another session (never kill
// it) — a shared/default port risks Playwright's webServer treating that
// foreign process as "already running" and testing the wrong app entirely.
const PORT = Number(process.env.E2E_PORT ?? 3107);

export default defineConfig({
  // The database is the one shared hosted Supabase project (dev == live),
  // so tests must not run concurrently against it.
  fullyParallel: false,
  workers: 1,
  // The default 30s per-test/hook timeout is too tight for this hosted
  // project's observed Admin API latency (GoTrue's listUsers, used by
  // every spec's beforeAll/afterAll sweepStaleTestData(), measured at
  // ~28s for a single call during gap-closure verification on
  // 2026-10-15 — not a one-off: reproduced twice in a row). This is
  // test-infra robustness for real backend latency, not a bug workaround.
  timeout: 60_000,
  projects: [
    {
      name: "api",
      testDir: "./tests/api",
    },
    {
      name: "e2e",
      testDir: "./tests/e2e",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${PORT}`,
      },
    },
  ],
  webServer: {
    command: `yarn dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
