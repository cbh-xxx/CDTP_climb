import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './account-e2e', fullyParallel: false, workers: 1, timeout: 45000,
  reporter: 'list', outputDir: process.env.ACCOUNT_VALIDATION_DIR,
  use: { baseURL: 'http://127.0.0.1:5184', headless: true, viewport: { width:1440,height:1024 } },
  webServer: { command: 'npm run dev:test -- --port 5184', url: 'http://127.0.0.1:5184', reuseExistingServer: false },
  projects: [{name:'chrome',use:{channel:'chrome'}},{name:'edge',use:{channel:'msedge'}}],
});
