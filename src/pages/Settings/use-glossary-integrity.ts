/**
 * useGlossaryIntegrity — fetches the glossary link-integrity report
 * (`GET /api/glossary/integrity`): glossary terms whose primary/secondary
 * catalog refs no longer resolve. Read-on-demand with an explicit Refresh,
 * mirroring useMetricCoverage.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/api-client';

export interface DanglingGlossaryRef {
  termId: string;
  label: string;
  ref: string;
  slot: 'primary' | 'secondary';
}

export interface GlossaryIntegrityReport {
  dangling: DanglingGlossaryRef[];
  generatedAt: string;
}

export interface UseGlossaryIntegrityResult {
  report: GlossaryIntegrityReport | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useGlossaryIntegrity(): UseGlossaryIntegrityResult {
  const [report, setReport] = useState<GlossaryIntegrityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const next = await apiFetch<GlossaryIntegrityReport>('/api/glossary/integrity');
      setReport(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { report, loading, error, refetch };
}
