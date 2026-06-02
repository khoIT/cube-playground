import { describe, it, expect } from 'vitest';
import { classifyLlmError } from '../src/core/llm-error-classifier.js';

describe('classifyLlmError', () => {
  it('classifies the gateway 403 / failed-to-authenticate case', () => {
    const c = classifyLlmError({
      message: 'Claude Code returned an error result: Failed to authenticate. API Error: 403 Forbidden',
    });
    expect(c.code).toBe('llm_gateway_forbidden');
    expect(c.hint.toLowerCase()).toContain('vpn');
    expect(c.retriable).toBe(false);
  });

  it('prefers 401 unauthorized over a bare forbidden match', () => {
    const c = classifyLlmError({ message: 'API Error: 401 Unauthorized — invalid x-api-key' });
    expect(c.code).toBe('llm_unauthorized');
  });

  it('classifies rate limiting', () => {
    const c = classifyLlmError({ message: 'API Error: 429 Too Many Requests' });
    expect(c.code).toBe('llm_rate_limited');
    expect(c.retriable).toBe(true);
  });

  it('classifies unreachable gateway from a network errno', () => {
    const c = classifyLlmError({ message: 'request to https://gw failed, reason: getaddrinfo ENOTFOUND gw' });
    expect(c.code).toBe('llm_unreachable');
    expect(c.retriable).toBe(true);
  });

  it('classifies model-unavailable', () => {
    const c = classifyLlmError({ message: 'model not found: claude-x' });
    expect(c.code).toBe('llm_model_unavailable');
  });

  it('classifies 5xx as a transient server error', () => {
    const c = classifyLlmError({ message: 'API Error: 502 Bad Gateway' });
    expect(c.code).toBe('llm_server_error');
    expect(c.retriable).toBe(true);
  });

  it('folds subtype into the match surface', () => {
    const c = classifyLlmError({ message: 'agent stopped', subtype: 'error_during_execution' });
    // No specific signal in the text → falls back, but never throws.
    expect(c.code).toBe('agent_error');
  });

  it('falls back for unrecognised errors without throwing', () => {
    const c = classifyLlmError({ message: 'something weird happened' });
    expect(c.code).toBe('agent_error');
    expect(c.title).toBeTruthy();
    expect(c.hint).toBeTruthy();
  });

  it('handles empty / null input', () => {
    expect(classifyLlmError({}).code).toBe('agent_error');
    expect(classifyLlmError({ message: null, subtype: null }).code).toBe('agent_error');
  });
});
