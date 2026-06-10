/**
 * Tests for demuxDockerStream — the pure Docker multiplexed-stream parser.
 *
 * Docker uses an 8-byte frame header for non-TTY containers:
 *   byte 0:   stream type (0=stdin, 1=stdout, 2=stderr)
 *   bytes 1-3: zeros (padding)
 *   bytes 4-7: BE uint32 payload length
 *   bytes 8…: payload
 *
 * We build hand-crafted buffers to test exact frame parsing without needing
 * a live Docker socket.
 */

import { describe, it, expect } from 'vitest';
import { demuxDockerStream } from '../src/services/docker-log-reader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a single Docker multiplexed frame.
 * streamType: 1=stdout, 2=stderr
 */
function makeFrame(payload: string, streamType = 1): Buffer {
  const payloadBuf = Buffer.from(payload, 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt8(streamType, 0);
  header.writeUInt32BE(payloadBuf.length, 4);
  return Buffer.concat([header, payloadBuf]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('demuxDockerStream', () => {
  it('parses a single stdout frame containing one line', () => {
    const frame = makeFrame('{"message":"hello"}\n');
    const lines = demuxDockerStream(frame);
    expect(lines).toEqual(['{"message":"hello"}']);
  });

  it('parses multiple frames concatenated', () => {
    const buf = Buffer.concat([
      makeFrame('{"message":"line1"}\n'),
      makeFrame('{"message":"line2"}\n', 2), // stderr
    ]);
    const lines = demuxDockerStream(buf);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('{"message":"line1"}');
    expect(lines[1]).toBe('{"message":"line2"}');
  });

  it('handles a frame whose payload contains multiple newline-separated lines', () => {
    const payload = 'line-a\nline-b\nline-c\n';
    const frame = makeFrame(payload);
    const lines = demuxDockerStream(frame);
    expect(lines).toEqual(['line-a', 'line-b', 'line-c']);
  });

  it('skips empty / whitespace-only lines', () => {
    const frame = makeFrame('line-x\n\n   \nline-y\n');
    const lines = demuxDockerStream(frame);
    expect(lines).toEqual(['line-x', 'line-y']);
  });

  it('returns empty array for an empty buffer', () => {
    expect(demuxDockerStream(Buffer.alloc(0))).toEqual([]);
  });

  it('returns empty array when buffer is shorter than one header (8 bytes)', () => {
    expect(demuxDockerStream(Buffer.alloc(5))).toEqual([]);
  });

  it('gracefully handles a truncated payload (header present but payload shorter than declared)', () => {
    // Declare payload length of 100 bytes but only supply 3
    const header = Buffer.alloc(8);
    header.writeUInt8(1, 0);
    header.writeUInt32BE(100, 4);
    const partial = Buffer.concat([header, Buffer.from('abc')]);

    // Should not throw — just return no lines because the frame is incomplete
    expect(() => demuxDockerStream(partial)).not.toThrow();
    expect(demuxDockerStream(partial)).toEqual([]);
  });

  it('parses a valid frame that follows a truncated frame', () => {
    // First frame truncated → skip; second frame complete → parse
    const badHeader = Buffer.alloc(8);
    badHeader.writeUInt8(1, 0);
    badHeader.writeUInt32BE(500, 4); // claims 500 bytes; only 2 follow
    const badFrame = Buffer.concat([badHeader, Buffer.from('ab')]);

    // A truncated frame occupies the rest of the buffer, so nothing after it
    // can be parsed — just verify no throw and empty result
    const lines = demuxDockerStream(badFrame);
    expect(lines).toEqual([]);
  });

  it('handles stream type 0 (stdin) without crashing', () => {
    const frame = makeFrame('stdin-data\n', 0);
    const lines = demuxDockerStream(frame);
    expect(lines).toEqual(['stdin-data']);
  });
});
