import { chromium, defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const localChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// No browser download is required when the Windows host already has Chrome.
const chromiumPath = !existsSync(chromium.executablePath()) && existsSync(localChrome) ? localChrome : undefined;
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1,
  reporter: 'list', use: { baseURL: 'http://127.0.0.1:4173', headless: true },
  outputDir: process.env.ACCOUNT_VALIDATION_DIR,
  webServer: [
    { command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
    { command: 'npm run dev:test -- --host 127.0.0.1', url: 'http://127.0.0.1:5174', reuseExistingServer: false },
  ],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { executablePath: chromiumPath } } },
    { name: 'chrome', use: { channel: 'chrome' } },
    { name: 'edge', use: { channel: 'msedge' } },
  ],
});
