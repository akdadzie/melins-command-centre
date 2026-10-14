import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // The staging acceptance suite runs only through `npm run acceptance`.
    exclude: [...configDefaults.exclude, 'acceptance/**'],
  },
})
