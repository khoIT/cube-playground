/**
 * Boot-time fail-closed: AUTH_DISABLED must never run under production.
 * (Tests default to AUTH_DISABLED='true' via vitest.config.ts.)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../src/index.js';

const prevNodeEnv = process.env.NODE_ENV;

describe('auth config fail-closed', () => {
  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv;
  });

  it('refuses to start when AUTH_DISABLED is truthy under NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(buildApp()).rejects.toThrow(/AUTH_DISABLED.*production/i);
  });

  it('starts normally when AUTH_DISABLED is on but NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'test';
    const app = await buildApp();
    expect(app).toBeTruthy();
    await app.close();
  });
});
