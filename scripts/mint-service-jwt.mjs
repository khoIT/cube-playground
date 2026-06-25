#!/usr/bin/env node
/**
 * Mint a long-lived cube-playground app JWT for a downstream service account.
 *
 * The guarded endpoints (GET /api/segments/:id and /membership-sql) verify an
 * HS256 app JWT signed with JWT_SECRET (server/src/services/app-jwt.ts), then
 * resolve authorization from the DB access store by EMAIL. So a minted token is
 * only accepted if its `email` has an ACTIVE access grant with read on the
 * segment's workspace — minting alone is not access. Grant the service account
 * in the admin access console first (role: viewer is enough for reads).
 *
 * Zero-dependency (node:crypto) so the downstream can run it without installing
 * anything. Claims mirror app-jwt.ts exactly: HS256, iss 'cube-playground'.
 *
 * Env:
 *   JWT_SECRET   the server's secret (>=16 chars) — from Vault: jupyter/prod/khoitn/cube-playground
 *   SUB          stable subject id (Keycloak sub for a real user, or any stable id) — default 'svc-segment-export'
 *   EMAIL        service-account email that holds the access grant (required)
 *   USERNAME     display username (default = EMAIL local part)
 *   ROLE         viewer|editor|admin embedded at mint (authz still resolved server-side) — default 'viewer'
 *   TTL_DAYS     token lifetime in days (default 365)
 *
 * Run:
 *   JWT_SECRET=... EMAIL=svc-segment@vng.com.vn node scripts/mint-service-jwt.mjs
 *   -> prints the bearer token (export as APP_JWT for the other scripts)
 */

import { createHmac } from 'node:crypto';

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 16) {
  console.error('JWT_SECRET must be set (>=16 chars).');
  process.exit(1);
}
const email = process.env.EMAIL;
if (!email) {
  console.error('EMAIL is required (must hold an active access grant).');
  process.exit(1);
}

const sub = process.env.SUB ?? 'svc-segment-export';
const username = process.env.USERNAME ?? email.split('@')[0];
const role = process.env.ROLE ?? 'viewer';
const ttlDays = Number(process.env.TTL_DAYS ?? 365);

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const now = Math.floor(Date.now() / 1000);
const header = { alg: 'HS256', typ: 'JWT' };
const payload = {
  iss: 'cube-playground', // must match app-jwt.ts ISSUER
  sub,
  username,
  email,
  role,
  iat: now,
  exp: now + Math.round(ttlDays * 24 * 60 * 60),
};

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const sig = b64url(createHmac('sha256', secret).update(signingInput).digest());
const token = `${signingInput}.${sig}`;

console.error(`# app JWT for ${email} (role=${role}, ttl=${ttlDays}d, exp=${new Date(payload.exp * 1000).toISOString()})`);
console.error('# NOTE: the email must have an ACTIVE access grant or guarded endpoints still 401/403.');
process.stdout.write(token + '\n');
