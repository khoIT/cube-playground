/**
 * Hooks for turn annotation (star / flag / note).
 *
 *   useTurnAnnotation(initial)  — local state seeded from initial annotation
 *   useSetTurnAnnotation()      — mutator; returns updated TurnAnnotation
 *   useDeleteTurnAnnotation()   — remove annotation row
 *
 * Annotation is loaded inline from GET /debug/turns/:id (which embeds it).
 * No separate GET endpoint needed — avoids redundant network call.
 * All mutation calls include X-Owner-Id; server enforces ownership.
 */

import { useState, useCallback } from 'react';
import { getOwnerId } from '../../api/chat-owner-id';
import type { TurnAnnotation, AnnotationFlag } from './use-debug-api-types';

export type { TurnAnnotation, AnnotationFlag };

function authHeaders(): Record<string, string> {
  return { 'X-Owner-Id': getOwnerId(), 'Content-Type': 'application/json' };
}

// ---------------------------------------------------------------------------
// useTurnAnnotation — local optimistic state seeded from parent turn detail
// ---------------------------------------------------------------------------

/**
 * Manages local annotation state seeded from the parent's turn detail load.
 * Call `setOptimistic` immediately on user action, then `useSetTurnAnnotation`
 * to persist — rollback on error if desired.
 */
export function useTurnAnnotation(initial: TurnAnnotation | null): {
  annotation: TurnAnnotation | null;
  setOptimistic: (next: TurnAnnotation | null) => void;
} {
  const [annotation, setAnnotation] = useState<TurnAnnotation | null>(initial);
  return { annotation, setOptimistic: setAnnotation };
}

// ---------------------------------------------------------------------------
// useSetTurnAnnotation — POST to upsert
// ---------------------------------------------------------------------------

export interface AnnotationInput {
  starred?: boolean;
  flag?: AnnotationFlag;
  note?: string | null;
}

export function useSetTurnAnnotation(): {
  set: (turnId: string, input: AnnotationInput) => Promise<TurnAnnotation>;
  isLoading: boolean;
  error: string | null;
} {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = useCallback(async (turnId: string, input: AnnotationInput): Promise<TurnAnnotation> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/debug/turns/${encodeURIComponent(turnId)}/annotation`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json() as Promise<TurnAnnotation>;
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { set, isLoading, error };
}

// ---------------------------------------------------------------------------
// useDeleteTurnAnnotation — DELETE to remove
// ---------------------------------------------------------------------------

export function useDeleteTurnAnnotation(): {
  remove: (turnId: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
} {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useCallback(async (turnId: string): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/debug/turns/${encodeURIComponent(turnId)}/annotation`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok && res.status !== 204) throw new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { remove, isLoading, error };
}
