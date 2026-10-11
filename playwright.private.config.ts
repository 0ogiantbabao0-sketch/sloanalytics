import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { randomBytes } from "node:crypto";
process.env.SLOT_PRIVATE_PASSWORD ||= randomBytes(24).toString("hex");
process.env.SLOT_PRIVATE_SECRET ||= randomBytes(32).toString("hex");
process.env.SLOT_PRIVATE_DIR ||= mkdtempSync("/tmp/slot-private-");
export default defineConfig({
  testDir: "./tests/private",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3200",
    ...devices["iPhone 13"],
    defaultBrowserType: "chromium",
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
  webServer: {
    command: "npm run db:setup && npm start -- --port 3200",
    url: "http://127.0.0.1:3200/api/health",
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      DATA_DIR: process.env.SLOT_PRIVATE_DIR,
      PRIVATE_ACCESS: "true",
      OWNER_PASSWORD: process.env.SLOT_PRIVATE_PASSWORD,
      OWNER_SESSION_SECRET: process.env.SLOT_PRIVATE_SECRET,
      ADMIN_IMPORT_TOKEN: "",
    },
  },
});
