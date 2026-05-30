/**
 * Triage view switcher: A · Queue + YAML / B · Entity graph / C · Conversational.
 * Persists the choice via the server-prefs store key `onboarding.triageView`
 * (free-form key/value, write-role gated server-side). Smart default by role
 * (analyst→A, visual→B, non-technical→C) then "remember last used".
 */
import { ReactElement, useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { getPref, setPref, subscribe } from '../../../hooks/server-prefs-store';

export type TriageView = 'builder' | 'queue' | 'graph' | 'chat';

const PREF_KEY = 'onboarding.triageView';

const VALID_VIEWS = new Set<TriageView>(['builder', 'queue', 'graph', 'chat']);

const VIEWS: Array<{ id: TriageView; label: string }> = [
  { id: 'builder', label: 'Builder' },
  { id: 'queue', label: 'Queue + YAML' },
  { id: 'graph', label: 'Entity graph' },
  { id: 'chat', label: 'Conversational' },
];

function defaultForRole(role: string | undefined): TriageView {
  if (role === 'viewer') return 'chat'; // least-technical default
  return 'builder'; // guided step-by-step is the default entry point
}

function readView(role: string | undefined): TriageView {
  const stored = getPref(PREF_KEY) as TriageView | null;
  if (stored && VALID_VIEWS.has(stored)) return stored;
  return defaultForRole(role);
}

const Group = styled.div`
  display: inline-flex;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-card);
`;
const Seg = styled.button<{ $active: boolean }>`
  appearance: none;
  border: none;
  background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--brand)' : 'var(--text-muted)')};
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  padding: 8px 14px;
  cursor: pointer;
  white-space: nowrap;
  & + & {
    border-left: 1px solid var(--border-card);
  }
  &:hover {
    color: var(--brand);
  }
`;

export function useTriageView(role: string | undefined): [TriageView, (v: TriageView) => void] {
  const [view, setView] = useState<TriageView>(() => readView(role));

  // React to hydration / cross-tab writes of the pref.
  useEffect(() => subscribe(PREF_KEY, () => setView(readView(role))), [role]);

  const choose = useCallback((v: TriageView) => {
    setView(v);
    setPref(PREF_KEY, v);
  }, []);

  return [view, choose];
}

interface Props {
  view: TriageView;
  onChange: (v: TriageView) => void;
}

export function ViewSwitch({ view, onChange }: Props): ReactElement {
  return (
    <Group role="tablist" aria-label="Triage view">
      {VIEWS.map((v) => (
        <Seg
          key={v.id}
          type="button"
          role="tab"
          aria-selected={view === v.id}
          $active={view === v.id}
          onClick={() => onChange(v.id)}
        >
          {v.label}
        </Seg>
      ))}
    </Group>
  );
}
