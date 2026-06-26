/**
 * Page-token codec: round-trip + validation defenses.
 */

import { describe, it, expect } from 'vitest';
import {
  encodePageToken,
  decodePageToken,
  InvalidPageTokenError,
  type PageToken,
} from '../src/services/segment-page-token.js';

const daily: PageToken = {
  v: 1,
  source: 'daily',
  segmentId: 'seg-1',
  snapshotDate: '2026-06-25',
  snapshotTs: '2026-06-25 08:00:00.000',
  lastUid: 'uid-0500',
};

describe('segment-page-token', () => {
  it('round-trips a daily token', () => {
    expect(decodePageToken(encodePageToken(daily))).toEqual(daily);
  });

  it('round-trips a manual token (no snapshot fields)', () => {
    const manual: PageToken = { v: 1, source: 'manual', segmentId: 'seg-2', lastUid: 'z' };
    expect(decodePageToken(encodePageToken(manual))).toEqual(manual);
  });

  it('preserves a null snapshotTs (legacy partition)', () => {
    const t = decodePageToken(encodePageToken({ ...daily, snapshotTs: null }));
    expect(t.snapshotTs).toBeNull();
  });

  it('rejects non-base64 / non-json garbage', () => {
    expect(() => decodePageToken('!!!not-a-token!!!')).toThrow(InvalidPageTokenError);
  });

  it('rejects an unsupported version', () => {
    const bad = Buffer.from(JSON.stringify({ ...daily, v: 2 })).toString('base64url');
    expect(() => decodePageToken(bad)).toThrow(InvalidPageTokenError);
  });

  it('rejects an unknown source', () => {
    const bad = Buffer.from(JSON.stringify({ ...daily, source: 'live' })).toString('base64url');
    expect(() => decodePageToken(bad)).toThrow(InvalidPageTokenError);
  });

  it('rejects a missing segmentId', () => {
    const bad = Buffer.from(JSON.stringify({ ...daily, segmentId: '' })).toString('base64url');
    expect(() => decodePageToken(bad)).toThrow(InvalidPageTokenError);
  });

  it('rejects a missing lastUid', () => {
    const { lastUid: _omit, ...rest } = daily;
    const bad = Buffer.from(JSON.stringify(rest)).toString('base64url');
    expect(() => decodePageToken(bad)).toThrow(InvalidPageTokenError);
  });
});
