import styled from 'styled-components';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import { useEligibleColumns, EligibleColumn } from '../../hooks/use-eligible-columns';
import type { InputSlot } from '../step-2-operation/operations';

const Wrap = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
`;
const Header = styled.header`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
`;
const Label = styled.h3`
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
`;
const Count = styled.span`
  font-size: 12px;
  color: var(--text-muted);
`;
const Empty = styled.div`
  padding: 18px;
  border: 1px dashed var(--border-card);
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--text-muted);
  text-align: center;
`;
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
`;
const CubeDivider = styled.div`
  grid-column: 1 / -1;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  font-family: var(--font-mono);
  padding: 6px 0 2px;
  border-top: 1px dashed var(--border-card);
  margin-top: 4px;
  &:first-child {
    margin-top: 0;
    border-top: none;
    padding-top: 0;
  }
`;
const Card = styled.button<{ $selected: boolean }>`
  text-align: left;
  background: ${(p) => (p.$selected ? 'var(--brand-soft)' : 'var(--bg-card)')};
  border: 1px solid ${(p) => (p.$selected ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  &:hover { border-color: var(--brand); }
`;
const Name = styled.div`
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const Sub = styled.div`
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 2px;
`;

export type SlotPickerProps = {
  slot: InputSlot;
  cubes: WizardCube[];
  /** Selected member's qualified name (e.g. "orders.amount") or null. */
  selected: string | null;
  onSelect: (memberName: string) => void;
};

export function SlotPicker({ slot, cubes, selected, onSelect }: SlotPickerProps) {
  const { eligible } = useEligibleColumns(cubes, slot.accepts);
  const showCubeDividers = cubes.length > 1;

  // Group eligible columns by cube for the multi-source divider rendering.
  const byCube = new Map<string, EligibleColumn[]>();
  for (const col of eligible) {
    const list = byCube.get(col.cubeName) ?? [];
    list.push(col);
    byCube.set(col.cubeName, list);
  }

  return (
    <Wrap>
      <Header>
        <Label>
          {slot.label}
          {slot.required ? '' : ' (optional)'}
        </Label>
        <Count>{eligible.length} {slot.accepts}</Count>
      </Header>
      {eligible.length === 0 ? (
        <Empty>No {slot.accepts} columns available across the selected source cubes.</Empty>
      ) : (
        <Grid>
          {Array.from(byCube.entries()).map(([cubeName, cols]) => (
            <PartGroup key={cubeName}>
              {showCubeDividers && <CubeDivider>{cubeName}</CubeDivider>}
              {cols.map((c) => (
                <Card
                  key={c.name}
                  $selected={selected === c.name}
                  onClick={() => onSelect(c.name)}
                  type="button"
                >
                  <Name>{c.name.split('.').slice(-1)[0]}</Name>
                  <Sub>
                    {c.type ?? '—'}
                    {showCubeDividers ? ` · ${cubeName}` : ''}
                  </Sub>
                </Card>
              ))}
            </PartGroup>
          ))}
        </Grid>
      )}
    </Wrap>
  );
}

// Wrapper for cube-group cards. CSS grid's `display: contents` lets the
// divider + cards flow as siblings inside the grid template.
const PartGroup = styled.div`
  display: contents;
`;
