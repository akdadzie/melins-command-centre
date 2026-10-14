// The staging acceptance suite (brief §13, Phase A). Run: npm run acceptance
// Files run in order, in one worker, sharing sign-ins and the records they create.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['acceptance.test.ts'],
    globalSetup: ['./global-setup.ts'],
    environment: 'node',
    isolate: false,
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { shuffle: false },
    testTimeout: 120_000,
    hookTimeout: 300_000,
    reporters: ['verbose'],
  },
})
