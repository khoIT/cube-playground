import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: {
      // Pre-Phase-6 tests don't carry app JWTs; keep them on the dev-mode
      // path so X-Owner contracts and write-roles gating behave as they
      // did before. Tests that exercise the real-auth surface override
      // process.env.AUTH_DISABLED in their own beforeEach.
      AUTH_DISABLED: 'true',
      JWT_SECRET: 'test-jwt-secret-must-be-at-least-16-chars',
    },
  },
});
