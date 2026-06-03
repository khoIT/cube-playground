import { describe, it, expect } from 'vitest';
import {
  glossaryTrust,
  metricVisibility,
  isValidRef,
  parseRef,
  GLOSSARY_VISIBILITY,
} from '../src/services/trust-mapping.js';

describe('glossaryTrust — legacy status/tier → unified trust', () => {
  it('official + non-experimental → certified', () => {
    expect(glossaryTrust('official', 'certified')).toBe('certified');
    expect(glossaryTrust('official', null)).toBe('certified');
  });
  it('experimental tier → draft regardless of status', () => {
    expect(glossaryTrust('official', 'experimental')).toBe('draft');
    expect(glossaryTrust('draft', 'experimental')).toBe('draft');
  });
  it('draft status → draft', () => {
    expect(glossaryTrust('draft', null)).toBe('draft');
    expect(glossaryTrust('draft', 'certified')).toBe('draft');
  });
});

describe('metricVisibility — YAML key with org default', () => {
  it('defaults to org when omitted/unknown', () => {
    expect(metricVisibility(undefined)).toBe('org');
    expect(metricVisibility(null)).toBe('org');
    expect(metricVisibility('bogus')).toBe('org');
  });
  it('passes through valid values', () => {
    expect(metricVisibility('personal')).toBe('personal');
    expect(metricVisibility('shared')).toBe('shared');
    expect(metricVisibility('org')).toBe('org');
  });
});

describe('glossary visibility is always org-wide', () => {
  it('exposes the org constant', () => {
    expect(GLOSSARY_VISIBILITY).toBe('org');
  });
});

describe('typed ref grammar — namespace allowlist', () => {
  it('accepts the three allowed namespaces', () => {
    expect(isValidRef('business_metrics/paying_users')).toBe(true);
    expect(isValidRef('data_model/mf_users.payer_tier')).toBe(true);
    expect(isValidRef('segments/b92b61ff-30a8-44b0-8a89-8064d8362c61')).toBe(true);
  });
  it('rejects unknown namespaces and malformed refs', () => {
    expect(isValidRef('glossary/whale')).toBe(false);
    expect(isValidRef('business_metrics')).toBe(false);
    expect(isValidRef('data_model/')).toBe(false);
    expect(isValidRef('segments/../etc')).toBe(false);
    expect(isValidRef('data_model/a b')).toBe(false);
  });
  it('parses a valid ref into namespace + id (id may contain dots)', () => {
    expect(parseRef('data_model/mf_users.payer_tier')).toEqual({
      namespace: 'data_model',
      id: 'mf_users.payer_tier',
    });
    expect(parseRef('business_metrics/paying_users')).toEqual({
      namespace: 'business_metrics',
      id: 'paying_users',
    });
  });
  it('returns null for an invalid ref', () => {
    expect(parseRef('glossary/whale')).toBeNull();
    expect(parseRef('segments/../x')).toBeNull();
  });
});
