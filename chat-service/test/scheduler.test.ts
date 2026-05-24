import { describe, it, expect, afterEach } from 'vitest';
import { scheduler } from '../src/services/scheduler.js';

describe('scheduler', () => {
  afterEach(() => scheduler.clear());

  it('validates cron expressions', () => {
    expect(() => scheduler.register('bad', 'this is not cron', () => undefined)).toThrow();
  });

  it('register / list returns registered jobs', () => {
    scheduler.register('refresh', '*/5 * * * *', () => undefined);
    expect(scheduler.list().map((j) => j.name)).toContain('refresh');
  });

  it('re-registering replaces the previous job', () => {
    scheduler.register('refresh', '*/5 * * * *', () => undefined);
    scheduler.register('refresh', '*/10 * * * *', () => undefined);
    const jobs = scheduler.list();
    const refresh = jobs.find((j) => j.name === 'refresh');
    expect(refresh?.schedule).toBe('*/10 * * * *');
    expect(jobs.filter((j) => j.name === 'refresh')).toHaveLength(1);
  });
});
