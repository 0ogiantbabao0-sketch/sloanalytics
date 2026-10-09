import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { randomBytes } from "node:crypto";
// Test-only credential and isolated databases; no production data is modified.
process.env.SLOT_E2E_TOKEN ||= randomBytes(32).toString("hex");
process.env.SLOT_E2E_DIR ||= mkdtempSync("/tmp/slot-e2e-");
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH || undefined,
        },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH || undefined,
        },
      },
    },
    { name: "iphone-webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "npm run db:setup && npm run dev -- --port 3100",
    env: {
      DATA_DIR: process.env.SLOT_E2E_DIR,
      ADMIN_IMPORT_TOKEN: process.env.SLOT_E2E_TOKEN,
    },
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
