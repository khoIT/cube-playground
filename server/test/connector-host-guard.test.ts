/**
 * Unit tests for the SSRF host guard: block loopback + cloud-metadata targets,
 * allow legitimate internal (RFC1918 / *.internal) and public warehouse hosts.
 */
import { describe, it, expect } from 'vitest';
import { assertSafeHost, isSafeHost, HostNotAllowedError } from '../src/services/connector-host-guard.js';

describe('connector-host-guard', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '127.0.0.1:8443',
    '169.254.169.254', // cloud metadata
    '0.0.0.0',
    '::1',
    'metadata.google.internal',
    '',
  ])('blocks SSRF target %s', (host) => {
    expect(isSafeHost(host)).toBe(false);
    expect(() => assertSafeHost(host)).toThrow(HostNotAllowedError);
  });

  it.each([
    'trino.internal',
    'trino.internal:8443',
    '10.20.30.40', // RFC1918 — legitimate internal warehouse
    '192.168.1.10',
    '172.16.5.5',
    'warehouse.prod.example.com',
  ])('allows legitimate host %s', (host) => {
    expect(isSafeHost(host)).toBe(true);
    expect(() => assertSafeHost(host)).not.toThrow();
  });
});
