/**
 * Fetch + state machine for the AI segment brief. Lazy: nothing is fetched
 * while `enabled` is false (card collapsed at mount), and the fetch re-runs
 * when the segment or the UI language changes. `retry()` forces a server-side
 * regeneration (?refresh=1 — rate-limited server-side to 1/10min).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { segmentsClient } from '../../../../api/segments-client';
import type { SegmentBriefPayload } from '../../../../api/segments-client';

export type BriefState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ok'; brief: SegmentBriefPayload; stale: boolean }
  | { phase: 'error'; message: string };

/** Normalize i18n language ('en', 'vi', 'en-AU', …) to the API's lang param. */
export function briefLang(language: string): 'en' | 'vi' {
  return language.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

export function useSegmentBrief(
  segmentId: string,
  enabled: boolean,
): { state: BriefState; retry: () => void } {
  const { i18n } = useTranslation();
  const lang = briefLang(i18n.language);
  const [state, setState] = useState<BriefState>({ phase: 'idle' });
  // Monotonic request id: a slow stale response must never overwrite the
  // result of a newer fetch (segment/lang switch, retry).
  const reqIdRef = useRef(0);

  const run = useCallback(
    async (refresh: boolean) => {
      const reqId = ++reqIdRef.current;
      setState({ phase: 'loading' });
      try {
        const res = await segmentsClient.getBrief(segmentId, lang, refresh);
        if (reqId !== reqIdRef.current) return;
        if (res.status === 'ok' && res.brief) {
          setState({ phase: 'ok', brief: res.brief, stale: res.stale === true });
        } else {
          setState({ phase: 'error', message: res.error ?? 'Brief unavailable' });
        }
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        setState({ phase: 'error', message: (err as Error).message || 'Brief unavailable' });
      }
    },
    [segmentId, lang],
  );

  useEffect(() => {
    if (!enabled) return;
    void run(false);
    // Invalidate in-flight responses when deps change/unmount.
    return () => {
      reqIdRef.current++;
    };
  }, [enabled, run]);

  const retry = useCallback(() => {
    void run(true);
  }, [run]);

  return { state, retry };
}
