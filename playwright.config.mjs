// Playwright config. System Chrome runs first when present.
// Plain Chromium covers machines without it. One worker holds
// the in-process E2E server, so tests run in file order.

import { existsSync } from "node:fs";

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const pick = process.env.PLAYWRIGHT_CHANNEL;
const hasChrome = pick === "chrome" || (!pick && CHROME_PATHS.some((p) => existsSync(p)));

export default {
  testDir: "./e2e",
  testMatch: "**/*.spec.mjs",
  timeout: 150_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    headless: true,
    reducedMotion: "no-preference",
    viewport: { width: 1440, height: 900 },
    ...(hasChrome ? { channel: "chrome" } : {}),
  },
};
