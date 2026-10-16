import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "fs";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

// SCRATCH, TEMPORARY, NOT PART OF THE PLAN — deleted before this task
// finishes. Mirrors playwright.config.ts's "api" and "e2e" projects but
// WITHOUT any webServer block, so Playwright neither spawns nor checks
// for a dev server lock. Used only because another `yarn dev` process
// (the user's own manual verification session on port 3001, same
// codebase, live via HMR) holds this project's `.next/dev/lock` and
// blocks Playwright's own webServer from starting a second server. The
// "e2e" project here connects directly to that already-running server.
export default defineConfig({
  fullyParallel: false,
  workers: 1,
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
        baseURL: "http://localhost:3001",
      },
    },
  ],
});
