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
    // src/test-setup.ts is applied only for src/ tests via environmentMatchGlobs below.
    // vite-plugins tests run in 'node' environment and need no DOM setup.
    setupFiles: [],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'vite-plugins/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', '.claude'],
    environmentMatchGlobs: [
      // vite-plugins tests: pure Node — no DOM, no React setup
      ['vite-plugins/**', 'node'],
    ],
  },
});
