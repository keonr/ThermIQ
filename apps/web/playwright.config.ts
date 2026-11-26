import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

const data = mkdtempSync(join(tmpdir(), 'thermiq-e2e-'))
process.once('exit', () => rmSync(data, { recursive: true, force: true }))
const api = 'http://127.0.0.1:48120'
const web = 'http://127.0.0.1:48121'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: web,
    launchOptions: { executablePath: process.env.THERMIQ_E2E_CHROMIUM, args: ["--enable-unsafe-swiftshader"] },
  },
  webServer: [
    {
      command: 'python -m uvicorn main:app --host 127.0.0.1 --port 48120',
      cwd: '../api',
      url: `${api}/api/health`,
      env: {
        THERMIQ_SESSION_DB: join(data, 'sessions.sqlite3'),
        THERMIQ_TELEMETRY_SOURCE: 'simulator',
        THERMIQ_SIMULATOR_SCENARIO: 'hot-right',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 48121 --strictPort',
      url: web,
      env: { THERMIQ_DEV_API_URL: api },
    },
  ],
})
