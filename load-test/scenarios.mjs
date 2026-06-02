/**
 * Scenario catalogue for the load harness.
 *
 * Each scenario names a target service, the cheap endpoint to probe for
 * latency-under-load, and a list of request specs autocannon cycles through.
 * Only SAFE reads are enabled by default. The `cube-load` scenario is opt-in
 * (reads load-query.json) because POST /load hits Trino; chat TURNS are
 * deliberately absent — they cost real LLM tokens and are rate-limited.
 *
 * All requests rely on AUTH_DISABLED=true in local dev (synthetic admin), so
 * no bearer token is needed; tenant scope rides the x-cube-* / x-owner-id
 * headers the real FE sends.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const SERVER = process.env.SERVER_URL ?? 'http://localhost:3004';
const CHAT = process.env.CHAT_URL ?? 'http://localhost:3005';
const GAME = process.env.GAME ?? 'ballistar';
const WS = process.env.WORKSPACE ?? 'local';

const wsHeaders = { 'x-cube-workspace': WS, 'x-cube-game': GAME };
const ownerHeaders = { 'x-owner-id': 'loadtest' };

/** Heavy server read paths the real app issues constantly. */
const serverReads = [
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/playground/games' },
  { method: 'GET', path: '/api/segments' },
  { method: 'GET', path: `/api/dashboards?game=${GAME}` },
  { method: 'GET', path: '/api/business-metrics' },
];

/** /meta proxies through to Cube — the heaviest cheap-looking GET. */
const cubeMeta = [{ method: 'GET', path: '/cube-api/v1/meta', headers: wsHeaders }];

/** chat-service synchronous DB reads (the endpoints that 504'd under load). */
const chatReads = [
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/notifications?unread=1&limit=50', headers: ownerHeaders },
  { method: 'GET', path: `/sessions?game=${GAME}`, headers: ownerHeaders },
];

export const scenarios = {
  'server-reads': { url: SERVER, probe: '/api/health', headers: wsHeaders, requests: serverReads },
  'cube-meta': { url: SERVER, probe: '/api/health', headers: wsHeaders, requests: cubeMeta },
  'chat-reads': { url: CHAT, probe: '/health', headers: ownerHeaders, requests: chatReads },
};

// Opt-in: POST /cube-api/v1/load with the body in load-query.json (if present).
const loadQueryPath = resolve(HERE, 'load-query.json');
if (existsSync(loadQueryPath)) {
  const body = readFileSync(loadQueryPath, 'utf8');
  scenarios['cube-load'] = {
    url: SERVER,
    probe: '/api/health',
    headers: wsHeaders,
    requests: [
      {
        method: 'POST',
        path: '/cube-api/v1/load',
        headers: { ...wsHeaders, 'content-type': 'application/json' },
        body,
      },
    ],
  };
}

export const scenarioNames = Object.keys(scenarios);
