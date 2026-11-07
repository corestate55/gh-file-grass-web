import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'core', root: 'packages/core', environment: 'happy-dom' } },
      { test: { name: 'github-adapter', root: 'packages/github-adapter', environment: 'node' } },
      { plugins: [vue()], test: { name: 'app', root: 'app', environment: 'happy-dom' } },
    ],
  },
})
