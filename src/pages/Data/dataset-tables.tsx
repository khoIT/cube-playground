/**
 * Dataset tables view: the two mode-pick cards (Reference existing model = warm
 * / Model from scratch = cold) over a profiled-tables table. Select rows →
 * Generate (POST /generate) which returns drafts the caller routes into triage.
 * Tables come from /introspect; a coarse profile bar + inferred role are
 * heuristic client-side hints (the real inference runs server-side in generate).
 * Styling all tokens; mirrors the table feel of existing data pages.
 */
import { ReactElement, useMemo, useState } from 'react';
import styled from 'styled-components';
import { ArrowRight, Check } from 'lucide-react';
import type { TableMeta } from '../../api/onboarding-client';

export type OnboardMode = 'warm' | 'cold';

const ModeRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;
const ModeCard = styled.button<{ $active: boolean }>`
  position: relative;
  text-align: left;
  background: var(--bg-card);
  border: 1px solid ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-card)')};
  box-shadow: ${(p) => (p.$active ? '0 0 0 1px var(--brand)' : 'none')};
  border-radius: var(--radius-lg);
  padding: 18px 20px;
  cursor: pointer;
  font-family: var(--font-sans);
`;
const ModeHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
`;
const ModeTitle = styled.span`
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
`;
const ModeTag = styled.span<{ $tone: 'warm' | 'cold' }>`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: var(--radius-pill);
  background: ${(p) => (p.$tone === 'warm' ? 'var(--success-soft)' : 'var(--info-soft)')};
  color: ${(p) => (p.$tone === 'warm' ? 'var(--success-ink)' : 'var(--info-ink)')};
`;
const Radio = styled.span<{ $active: boolean }>`
  position: absolute;
  top: 18px;
  right: 18px;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  border: 2px solid ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-strong)')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  &::after {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  }
`;
const ModeBody = styled.p`
  margin: 0 0 10px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-secondary);
`;
const ModeMeta = styled.div`
  font-size: 12px;
  color: var(--text-muted);
  & b {
    color: var(--text-secondary);
    font-weight: 600;
  }
`;

const TablesHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
`;
const TablesTitle = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
`;
const Table = styled.div`
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--bg-card);
`;
const Th = styled.div`
  display: grid;
  grid-template-columns: 36px 1fr 80px 120px;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
`;
const Tr = styled.button<{ $on: boolean }>`
  display: grid;
  grid-template-columns: 36px 1fr 80px 120px;
  gap: 12px;
  align-items: center;
  width: 100%;
  text-align: left;
  padding: 12px 16px;
  border: none;
  border-top: 1px solid var(--border-card);
  background: ${(p) => (p.$on ? 'var(--brand-soft)' : 'transparent')};
  cursor: pointer;
  font-family: var(--font-sans);
  &:hover {
    background: ${(p) => (p.$on ? 'var(--brand-soft)' : 'var(--bg-muted)')};
  }
`;
const Box = styled.span<{ $on: boolean }>`
  width: 18px;
  height: 18px;
  border-radius: var(--radius-xs);
  border: 1px solid ${(p) => (p.$on ? 'var(--brand)' : 'var(--border-strong)')};
  background: ${(p) => (p.$on ? 'var(--brand)' : 'transparent')};
  color: var(--text-on-brand, #fff);
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;
const TblName = styled.span`
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  color: var(--text-primary);
`;
const Cols = styled.span`
  font-size: 12.5px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
`;
const RolePill = styled.span<{ $ignore: boolean }>`
  justify-self: start;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: ${(p) => (p.$ignore ? 'var(--bg-muted)' : 'var(--info-soft)')};
  color: ${(p) => (p.$ignore ? 'var(--text-muted)' : 'var(--info-ink)')};
`;
const PrimaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--brand);
  color: var(--text-on-brand, #fff);
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

/** Coarse client-side role hint until the server returns the inference. */
function roleHint(t: TableMeta): { role: string; ignore: boolean } {
  const name = t.table.toLowerCase();
  if (name.startsWith('_tmp') || name.startsWith('tmp_') || name.includes('test') || name.includes('backfill'))
    return { role: 'likely ignore', ignore: true };
  const hasFk = t.columns.some((c) => /_id$/.test(c.name) && c.name !== 'id');
  return { role: hasFk ? 'fact' : 'dimension', ignore: false };
}

interface Props {
  tables: TableMeta[];
  mode: OnboardMode;
  onModeChange: (m: OnboardMode) => void;
  canWrite: boolean;
  generating: boolean;
  warmSource?: string | null;
  onGenerate: (selected: string[], mode: OnboardMode) => void;
}

export function DatasetTables({
  tables,
  mode,
  onModeChange,
  canWrite,
  generating,
  warmSource,
  onGenerate,
}: Props): ReactElement {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const factTables = useMemo(
    () => tables.filter((t) => !roleHint(t).ignore).map((t) => t.table),
    [tables],
  );

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <>
      <ModeRow role="radiogroup" aria-label="Onboarding mode">
        <ModeCard type="button" role="radio" aria-checked={mode === 'warm'} $active={mode === 'warm'} onClick={() => onModeChange('warm')}>
          <Radio $active={mode === 'warm'} aria-hidden />
          <ModeHead>
            <ModeTitle>Reference existing model</ModeTitle>
            <ModeTag $tone="warm">Warm start</ModeTag>
          </ModeHead>
          <ModeBody>Imitate sibling cubes already modeled in this connector. Best when conventions exist.</ModeBody>
          <ModeMeta>
            <div>
              <b>Learns:</b> naming, identity fields, join &amp; measure style
            </div>
            <div>
              <b>Result:</b> higher confidence → fewer questions
            </div>
            <div>
              <b>Source:</b> {warmSource || 'sibling cubes in this connector'}
            </div>
          </ModeMeta>
        </ModeCard>

        <ModeCard type="button" role="radio" aria-checked={mode === 'cold'} $active={mode === 'cold'} onClick={() => onModeChange('cold')}>
          <Radio $active={mode === 'cold'} aria-hidden />
          <ModeHead>
            <ModeTitle>Model from scratch</ModeTitle>
            <ModeTag $tone="cold">Cold start</ModeTag>
          </ModeHead>
          <ModeBody>Pure profiling + LLM inference. For a genuinely new shape with no precedent.</ModeBody>
          <ModeMeta>
            <div>
              <b>Uses:</b> column stats, samples, naming heuristics
            </div>
            <div>
              <b>Result:</b> more low-confidence calls to review
            </div>
            <div>
              <b>Source:</b> none — fresh data layer
            </div>
          </ModeMeta>
        </ModeCard>
      </ModeRow>

      <TablesHead>
        <TablesTitle>
          Tables · {selected.size} of {tables.length} selected
        </TablesTitle>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => setSelected(new Set(factTables))}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-sans)',
              fontSize: 12.5,
              fontWeight: 500,
              padding: '7px 12px',
              cursor: 'pointer',
            }}
          >
            Select fact tables
          </button>
          {canWrite ? (
            <PrimaryBtn
              type="button"
              disabled={selected.size === 0 || generating}
              onClick={() => onGenerate([...selected], mode)}
            >
              {generating ? 'Generating…' : 'Generate draft'}
              <ArrowRight size={14} />
            </PrimaryBtn>
          ) : null}
        </div>
      </TablesHead>

      <Table>
        <Th>
          <span />
          <span>Table</span>
          <span>Columns</span>
          <span>Inferred role</span>
        </Th>
        {tables.map((t) => {
          const on = selected.has(t.table);
          const hint = roleHint(t);
          return (
            <Tr key={`${t.schema}.${t.table}`} type="button" $on={on} onClick={() => toggle(t.table)}>
              <Box $on={on} aria-hidden>
                {on ? <Check size={12} strokeWidth={3} /> : null}
              </Box>
              <TblName style={hint.ignore ? { color: 'var(--text-muted)' } : undefined}>{t.table}</TblName>
              <Cols>{t.columns.length}</Cols>
              <RolePill $ignore={hint.ignore}>{hint.role}</RolePill>
            </Tr>
          );
        })}
      </Table>
    </>
  );
}
