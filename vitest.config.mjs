import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/tests/**/*.test.js'],
    setupFiles: ['server/tests/setup.js'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'lcov', 'html'],
      include: ['server/**/*.js'],
      exclude: [
        'server/node_modules/**',
        'server/tests/**',
        'server/scripts/**',
        'server/server.js'
      ]
    }
  }
})
