/**
 * Tiny mutation hook wrapping the glossary client calls. Keeps modal and
 * row code free of fetch lifecycle plumbing. Error messages bubble through
 * `error` so callers can render a toast or inline notice; the hook never
 * throws.
 */

import { useCallback, useState } from 'react';
import {
  createGlossary,
  updateGlossary,
  deleteGlossary,
  setGlossaryStatus,
  type CreateGlossaryInput,
  type GlossaryStatus,
  type GlossaryTerm,
  type GlossaryWriteInput,
} from '../../../api/glossary-client';

export interface UseGlossaryMutationsResult {
  saving: boolean;
  error: string | null;
  resetError: () => void;
  create: (input: CreateGlossaryInput) => Promise<GlossaryTerm | null>;
  update: (id: string, input: GlossaryWriteInput) => Promise<GlossaryTerm | null>;
  remove: (id: string) => Promise<boolean>;
  setStatus: (id: string, status: GlossaryStatus, editorName?: string) => Promise<GlossaryTerm | null>;
}

export function useGlossaryMutations(): UseGlossaryMutationsResult {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setSaving(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    saving,
    error,
    resetError: () => setError(null),
    create: (input) => guard(() => createGlossary(input)),
    update: (id, input) => guard(() => updateGlossary(id, input)),
    remove: (id) =>
      guard(async () => {
        await deleteGlossary(id);
        return true;
      }).then((v) => v ?? false),
    setStatus: (id, status, editorName) => guard(() => setGlossaryStatus(id, status, editorName)),
  };
}
