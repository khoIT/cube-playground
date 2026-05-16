import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CdpProjectionCard } from '../cdp-projection-card';
import type { CdpMetricPayload, ProjectionResult } from '../types';

const payload: CdpMetricPayload = {
  game_id: 'bal_vn',
  metric_name: 'user_count',
  metric_codename: 'user_count',
  source: 'iceberg.ballistar_vn.mf_users',
  expression: 'COUNT(*)',
  dimensions: ['country', 'signup_source'],
  filter: '',
};

const ok: ProjectionResult = { ok: true, payload };

function fetchOk(data: object = { ...payload, materialize: false, schedule: '', created_at: '', updated_at: '' }) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ status: 'SUCCESS', error: null, data }),
  })) as unknown as typeof fetch;
}

function fetch404() {
  globalThis.fetch = vi.fn(async () => ({
    ok: false, status: 404, json: async () => ({ status: 'ERROR', error: { code: 'METRIC_NOT_FOUND' } }),
  })) as unknown as typeof fetch;
}

function fetch500() {
  globalThis.fetch = vi.fn(async () => ({
    ok: false, status: 500, json: async () => ({ status: 'ERROR', error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
  })) as unknown as typeof fetch;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('<CdpProjectionCard>', () => {
  it('projectable: renders all 7 field labels + Verify button + Not checked badge', () => {
    fetchOk();
    render(<CdpProjectionCard projection={ok} />);
    for (const label of ['game_id', 'metric_name', 'metric_codename', 'source', 'expression', 'dimensions', 'filter']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /verify on cdp/i })).toBeTruthy();
    expect(screen.getByTestId('badge-idle')).toBeTruthy();
  });

  it('verify click → calls fetch and badge becomes Available on match', async () => {
    fetchOk();
    render(<CdpProjectionCard projection={ok} />);
    fireEvent.click(screen.getByRole('button', { name: /verify on cdp/i }));
    await waitFor(() => expect(screen.getByTestId('badge-available')).toBeTruthy());
  });

  it('404 → Missing badge', async () => {
    fetch404();
    render(<CdpProjectionCard projection={ok} />);
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(screen.getByTestId('badge-missing')).toBeTruthy());
  });

  it('mismatch → red badge + diff list w/ .diff-expected and .diff-actual classes', async () => {
    fetchOk({ ...payload, expression: 'SUM(amount_usd)', materialize: false, schedule: '', created_at: '', updated_at: '' });
    render(<CdpProjectionCard projection={ok} />);
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(screen.getByTestId('badge-mismatch')).toBeTruthy());
    const list = screen.getByTestId('diff-list');
    expect(list.querySelector('.diff-expected')).toBeTruthy();
    expect(list.querySelector('.diff-actual')).toBeTruthy();
    expect(list.querySelector('.diff-expected')?.textContent).toContain('COUNT(*)');
    expect(list.querySelector('.diff-actual')?.textContent).toContain('SUM(amount_usd)');
  });

  it('500 → Error badge + Retry button', async () => {
    fetch500();
    render(<CdpProjectionCard projection={ok} />);
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(screen.getByTestId('badge-error')).toBeTruthy());
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('not projectable → disabled card, NO verify button (queryByRole returns null), reason text visible', () => {
    const np: ProjectionResult = { ok: false, reason: 'references-other-measures' };
    render(<CdpProjectionCard projection={np} />);
    expect(screen.getByTestId('cdp-card-not-projectable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /verify/i })).toBeNull();
    expect(screen.getByText(/references other measures/i)).toBeTruthy();
  });

  it('not projectable w/ unsupported-agg-type → human reason rendered', () => {
    const np: ProjectionResult = { ok: false, reason: 'unsupported-agg-type' };
    render(<CdpProjectionCard projection={np} />);
    expect(screen.getByText(/unsupported aggregation type/i)).toBeTruthy();
  });

  it('copy json → writes JSON.stringify(payload) to clipboard + shows Copied! transient label', async () => {
    fetchOk();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<CdpProjectionCard projection={ok} />);
    const copyBtn = screen.getByTestId('copy-json');
    expect(copyBtn.textContent).toMatch(/copy json/i);
    fireEvent.click(copyBtn);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const written = writeText.mock.calls[0][0] as string;
    expect(JSON.parse(written)).toEqual(payload);
    await waitFor(() => expect(screen.getByTestId('copy-json').textContent).toMatch(/copied!/i));
  });

  it('copy json fallback → uses document.execCommand when clipboard rejects', async () => {
    fetchOk();
    const writeText = vi.fn(async () => { throw new Error('denied'); });
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    render(<CdpProjectionCard projection={ok} />);
    fireEvent.click(screen.getByTestId('copy-json'));
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
  });

  it('verify button disabled while checking', async () => {
    let resolve: (v: any) => void = () => {};
    globalThis.fetch = vi.fn(() => new Promise((r) => { resolve = r; })) as unknown as typeof fetch;
    render(<CdpProjectionCard projection={ok} />);
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(screen.getByTestId('badge-checking')).toBeTruthy());
    expect(screen.getByRole('button', { name: /verify/i }).hasAttribute('disabled')).toBe(true);
    resolve({ ok: true, status: 200, json: async () => ({ status: 'SUCCESS', data: { ...payload, materialize: false, schedule: '', created_at: '', updated_at: '' } }) });
  });
});
