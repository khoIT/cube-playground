/**
 * useAppSettings — small SWR-ish hook for /api/settings.
 *
 * Polls every 60s so multiple tabs converge. PATCH calls invalidate the
 * cache and trigger an immediate refetch.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/api-client';

export type AppSettings = Record<string, unknown>;

const POLL_INTERVAL_MS = 60_000;

export interface UseAppSettingsResult {
  settings: AppSettings;
  loading: boolean;
  error: string | null;
  patch: (key: string, value: unknown) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useAppSettings(): UseAppSettingsResult {
  const [settings, setSettings] = useState<AppSettings>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async () => {
    try {
      const next = await apiFetch<AppSettings>('/api/settings');
      setSettings(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const patch = useCallback(async (key: string, value: unknown) => {
    await apiFetch('/api/settings', {
      method: 'PATCH',
      body: { key, value },
    });
    await fetchOnce();
  }, [fetchOnce]);

  useEffect(() => {
    void fetchOnce();
    const interval = setInterval(() => void fetchOnce(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchOnce]);

  return { settings, loading, error, patch, refetch: fetchOnce };
}
