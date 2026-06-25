import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Global setup: resets the server-pref store cache between tests so
    // localStorage-seeding suites aren't shadowed by cross-test cache state.
    // Harmless (a Map clear) for the 'node'-env vite-plugins tests.
    setupFiles: ['src/test-setup.ts'],
    css: false,
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'vite-plugins/**/*.{test,spec}.ts',
      'scripts/**/*.{test,spec}.mjs',
    ],
    exclude: ['node_modules', 'dist', '.claude'],
    environmentMatchGlobs: [
      // vite-plugins + scripts tests: pure Node — no DOM, no React setup
      ['vite-plugins/**', 'node'],
      ['scripts/**', 'node'],
    ],
    // Forks isolate jsdom DOMs per file — heap is reclaimed on file end,
    // unlike threads which share a V8 isolate per worker and leak across files.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
        execArgv: ['--max-old-space-size=4096'],
      },
    },
    logHeapUsage: true,
  },
});
