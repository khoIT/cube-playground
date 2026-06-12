/**
 * Tests for consumeBuildLogSnapshots: chronological ordering by epoch-prefixed
 * filename, consume-once deletion, and absent-dir tolerance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { consumeBuildLogSnapshots } from '../src/services/preagg-build-log-snapshot-ingest.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'preagg-snap-'));
  process.env.PREAGG_BUILD_LOG_SNAPSHOT_DIR = dir;
});

afterEach(() => {
  delete process.env.PREAGG_BUILD_LOG_SNAPSHOT_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('consumeBuildLogSnapshots', () => {
  it('returns lines from all .log files oldest-first and deletes them', () => {
    writeFileSync(join(dir, '1760000100-tf-window.log'), 'line-b1\nline-b2\n');
    writeFileSync(join(dir, '1760000000-tf-prescope.log'), 'line-a1\n\n  \n');
    writeFileSync(join(dir, 'not-a-snapshot.txt'), 'ignored');

    expect(consumeBuildLogSnapshots()).toEqual(['line-a1', 'line-b1', 'line-b2']);
    // .log files consumed; the non-.log file untouched
    expect(readdirSync(dir)).toEqual(['not-a-snapshot.txt']);
    // Second pass: nothing left
    expect(consumeBuildLogSnapshots()).toEqual([]);
  });

  it('returns [] when the snapshot dir does not exist', () => {
    process.env.PREAGG_BUILD_LOG_SNAPSHOT_DIR = join(dir, 'nope');
    expect(consumeBuildLogSnapshots()).toEqual([]);
  });
});
