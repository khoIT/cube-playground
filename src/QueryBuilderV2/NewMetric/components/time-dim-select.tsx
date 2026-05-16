import styled from 'styled-components';

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.label`
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
`;

const Select = styled.select`
  appearance: none;
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-input);
  padding: 6px 10px;
  font-size: 13px;
  color: var(--text-primary);
`;

interface TimeDimSelectProps {
  options: string[];
  value: string | null;
  onChange: (next: string | null) => void;
}

export function TimeDimSelect({ options, value, onChange }: TimeDimSelectProps) {
  return (
    <Wrapper>
      <Label htmlFor="time-dim">Time dimension</Label>
      <Select
        id="time-dim"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">— Scalar only —</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </Select>
    </Wrapper>
  );
}
