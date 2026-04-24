import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Prefer .ts / .tsx over stale .js build artifacts that sometimes sit
  // alongside source files. Vite's default resolution picks .js first, which
  // silently shadows fresh TypeScript edits when an old compile is around.
  resolve: {
    extensions: ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.json']
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules/**', 'out/**']
  }
})
