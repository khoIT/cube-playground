import { Profiler, ReactNode, type ProfilerOnRenderCallback } from 'react';

export type PerfCounterEntry = {
  mount: number;
  update: number;
  totalMs: number;
};

export type PerfCounts = Record<string, PerfCounterEntry>;

declare global {
  interface Window {
    __perfCounts?: PerfCounts;
  }
}

function getCounters(): PerfCounts {
  if (typeof window === 'undefined') return {};
  if (!window.__perfCounts) window.__perfCounts = {};
  return window.__perfCounts;
}

export const onPerfRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration
) => {
  const counts = getCounters();
  if (!counts[id]) counts[id] = { mount: 0, update: 0, totalMs: 0 };
  if (phase === 'mount') counts[id].mount += 1;
  else if (phase === 'update') counts[id].update += 1;
  counts[id].totalMs += actualDuration;
};

export function resetPerfCounts(id?: string): void {
  if (typeof window === 'undefined') return;
  if (!id) {
    window.__perfCounts = {};
    return;
  }
  const counts = getCounters();
  delete counts[id];
}

function isDev(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

export interface PerfProbeProps {
  id: string;
  children: ReactNode;
}

export function PerfProbe({ id, children }: PerfProbeProps) {
  if (!isDev()) return <>{children}</>;
  return (
    <Profiler id={id} onRender={onPerfRender}>
      {children}
    </Profiler>
  );
}
