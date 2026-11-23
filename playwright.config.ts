import { defineConfig } from '@playwright/test';

const port = process.env.WB_TEST_PORT ?? '18787';
export default defineConfig({
  testDir: './tests', timeout: 30_000, fullyParallel: false,
  use: { baseURL: `http://127.0.0.1:${port}`, channel: 'chromium', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  webServer: { command: 'npm start', url: `http://127.0.0.1:${port}/api/health`, reuseExistingServer: !process.env.CI, env: { DATA_DIR: '.data/e2e', PORT: port } },
});
