/**
 * Intent-router tests for the prescriptive `advise` door.
 *
 * Prescriptive "what should I DO" phrasing must reach `advise` (and auto-chain
 * downstream), while the diagnostic "why" door and the descriptive "show" door
 * stay exactly as they were — the split is the whole point of the second door.
 */

import { describe, it, expect } from 'vitest';
import { routeIntent } from '../src/core/intent-router.js';

describe('routeIntent — advise (prescriptive) door', () => {
  it('"what should I do to grow cfm_vn revenue?" → advise, autoRoute true', () => {
    const r = routeIntent('what should I do to grow cfm_vn revenue?');
    expect(r.skill).toBe('advise');
    expect(r.autoRoute).toBe(true);
  });

  it('"how do I improve jus_vn retention?" → advise', () => {
    const r = routeIntent('how do I improve jus_vn retention?');
    expect(r.skill).toBe('advise');
    expect(r.autoRoute).toBe(true);
  });

  it('"what should I focus on this week?" → advise', () => {
    const r = routeIntent('what should I focus on this week?');
    expect(r.skill).toBe('advise');
    expect(r.autoRoute).toBe(true);
  });

  it('"recommendations for growing revenue" → advise', () => {
    const r = routeIntent('recommendations for growing revenue');
    expect(r.skill).toBe('advise');
    expect(r.autoRoute).toBe(true);
  });

  it('"nên làm gì để cải thiện D7?" → advise (Vietnamese)', () => {
    const r = routeIntent('nên làm gì để cải thiện D7?');
    expect(r.skill).toBe('advise');
    expect(r.autoRoute).toBe(true);
  });

  it('"/advise grow revenue" → advise, confidence 1 (slash)', () => {
    const r = routeIntent('/advise grow revenue');
    expect(r.skill).toBe('advise');
    expect(r.confidence).toBe(1);
    expect(r.autoRoute).toBe(true);
  });
});

describe('routeIntent — doors stay distinct', () => {
  it('"why did revenue drop yesterday?" still → diagnose (not advise)', () => {
    const r = routeIntent('why did revenue drop yesterday?');
    expect(r.skill).toBe('diagnose');
  });

  it('"show revenue by platform" still → explore (not advise)', () => {
    const r = routeIntent('show revenue by platform');
    expect(r.skill).toBe('explore');
  });

  it('"fix the chart" → explore — descriptive "chart" outweighs the short "fix"', () => {
    const r = routeIntent('fix the chart');
    expect(r.skill).toBe('explore');
  });
});
