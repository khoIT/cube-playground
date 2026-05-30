/**
 * SSRF guard for connector hosts. v2 lets a user supply the warehouse host (v1
 * hosts were server-owned), so a connect/probe to that host is an outbound
 * request we must constrain.
 *
 * Threat we block: pivoting the server into loopback / cloud-metadata endpoints
 * (the classic SSRF target, e.g. 169.254.169.254 for AWS/GCP credentials).
 *
 * We deliberately ALLOW RFC1918 private ranges (10/172.16-31/192.168) and
 * `*.internal` — legitimate internal warehouses live there. This is a pragmatic
 * literal-host check, not DNS-resolving egress filtering; flagged for the
 * post-ship /ck:security review to harden (resolve + re-check, allowlist).
 */

export class HostNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostNotAllowedError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

/** Throws HostNotAllowedError if `host` targets loopback or a metadata endpoint. */
export function assertSafeHost(host: string): void {
  const trimmed = (host ?? '').trim().toLowerCase();
  if (!trimmed) throw new HostNotAllowedError('host is required');

  // Normalize to a bare hostname. Bracketed IPv6 ([::1]:port) → inner literal;
  // host:port (≤1 colon) → drop the port; bare IPv6 (multiple colons) → as-is so
  // the trailing-:port strip never mangles `::1`.
  let hostname = trimmed;
  if (hostname.startsWith('[')) {
    hostname = hostname.replace(/^\[([^\]]+)\](?::\d+)?$/, '$1');
  } else if ((hostname.match(/:/g)?.length ?? 0) <= 1) {
    hostname = hostname.replace(/:\d+$/, '');
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new HostNotAllowedError(`host "${hostname}" is not allowed`);
  }
  // IPv4 loopback (127.0.0.0/8).
  if (/^127\./.test(hostname)) {
    throw new HostNotAllowedError('loopback hosts are not allowed');
  }
  // Link-local / cloud metadata (169.254.0.0/16).
  if (/^169\.254\./.test(hostname)) {
    throw new HostNotAllowedError('link-local / metadata hosts are not allowed');
  }
}

/** Non-throwing variant for callers that want a boolean. */
export function isSafeHost(host: string): boolean {
  try {
    assertSafeHost(host);
    return true;
  } catch {
    return false;
  }
}
