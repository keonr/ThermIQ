import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: { '/api': process.env.THERMIQ_DEV_API_URL ?? 'http://127.0.0.1:8000' },
  },
})
