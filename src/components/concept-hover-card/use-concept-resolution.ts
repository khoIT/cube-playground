/**
 * useConceptResolution — module-level cache for concept relations fetches.
 *
 * Mirrors the caching shape of use-identity-map: a single in-flight promise
 * per ref, shared across all hover-card instances in a tab. This prevents
 * per-anchor fetch storms when many chips are visible simultaneously.
 *
 * Cache is never invalidated during a tab session — concept relations are
 * stable within a browsing session and the endpoint has no mutation side-effects.
 */

import { useEffect, useState } from 'react';
import { getConceptRelations, type ConceptRelations } from '../../api/concepts-client';

// Module-level cache: ref → settled result (success or error marker).
const resolved = new Map<string, ConceptRelations>();
const errors = new Map<string, Error>();
const inflight = new Map<string, Promise<void>>();
// Subscriber sets per ref — notified when the fetch settles.
const listeners = new Map<string, Set<() => void>>();

function notify(ref: string): void {
  listeners.get(ref)?.forEach((cb) => cb());
}

function fetchRef(ref: string): Promise<void> {
  if (inflight.has(ref)) return inflight.get(ref)!;
  // No AbortSignal: the fetch is shared across all subscribers and its result is
  // cached module-wide. Tying it to one subscriber's lifecycle would let that
  // subscriber's unmount abort the shared request and poison the cache for every
  // other (and future) subscriber on the same ref. Subscribers simply detach
  // their listener on unmount; the request runs to completion and caches once.
  const p = getConceptRelations(ref)
    .then((data) => {
      resolved.set(ref, data);
      inflight.delete(ref);
      notify(ref);
    })
    .catch((err: Error) => {
      errors.set(ref, err);
      inflight.delete(ref);
      notify(ref);
    });
  inflight.set(ref, p);
  return p;
}

interface ConceptResolutionState {
  data: ConceptRelations | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Returns the resolved ConceptRelations for `ref`, fetching once and caching
 * the result module-wide. When `ref` is null/empty, returns idle state.
 */
export function useConceptResolution(ref: string | null): ConceptResolutionState {
  const [state, setState] = useState<ConceptResolutionState>(() => {
    if (!ref) return { data: null, loading: false, error: null };
    if (resolved.has(ref)) return { data: resolved.get(ref)!, loading: false, error: null };
    if (errors.has(ref)) return { data: null, loading: false, error: errors.get(ref)! };
    return { data: null, loading: true, error: null };
  });

  useEffect(() => {
    if (!ref) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    // Already cached — sync update avoids a flicker.
    if (resolved.has(ref)) {
      setState({ data: resolved.get(ref)!, loading: false, error: null });
      return;
    }
    if (errors.has(ref)) {
      setState({ data: null, loading: false, error: errors.get(ref)! });
      return;
    }

    // Subscribe to settlement notification.
    setState({ data: null, loading: true, error: null });
    const onSettle = () => {
      if (resolved.has(ref)) {
        setState({ data: resolved.get(ref)!, loading: false, error: null });
      } else {
        setState({ data: null, loading: false, error: errors.get(ref) ?? null });
      }
    };

    if (!listeners.has(ref)) listeners.set(ref, new Set());
    listeners.get(ref)!.add(onSettle);

    fetchRef(ref);

    return () => {
      listeners.get(ref)?.delete(onSettle);
    };
  }, [ref]);

  return state;
}

/** Test helper — wipes the module-level cache between suites. */
export function _resetConceptResolutionCache(): void {
  resolved.clear();
  errors.clear();
  inflight.clear();
  listeners.clear();
}
