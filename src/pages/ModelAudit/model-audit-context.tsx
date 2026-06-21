/**
 * Shares the currently-selected audit run across the Model Audit tabs so the
 * Findings heatmap, Diffs, and Trend views all read from the same run without
 * each tab owning its own run-picker state. `runId === 'latest'` resolves to the
 * newest ok run server-side.
 */

import React, { createContext, useContext, useState } from 'react';

interface ModelAuditCtx {
  selectedRunId: number | 'latest';
  setSelectedRunId: (id: number | 'latest') => void;
}

const Ctx = createContext<ModelAuditCtx | null>(null);

export function ModelAuditProvider({ children }: { children: React.ReactNode }) {
  const [selectedRunId, setSelectedRunId] = useState<number | 'latest'>('latest');
  return <Ctx.Provider value={{ selectedRunId, setSelectedRunId }}>{children}</Ctx.Provider>;
}

export function useModelAuditContext(): ModelAuditCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useModelAuditContext must be used within ModelAuditProvider');
  return ctx;
}
