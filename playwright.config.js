import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: 'responsive.e2e.spec.js',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:8090',
    browserName: 'chromium',
  },
})