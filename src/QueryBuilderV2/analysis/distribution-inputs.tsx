import { InputNumber, Select } from 'antd';
import { Flow, Paragraph, tasty } from '@cube-dev/ui-kit';

const InputsRow = tasty({
  styles: {
    display: 'grid',
    gridColumns: '1fr 1fr 1fr',
    gap: '1x',
    placeItems: 'end stretch',
  },
});

interface Member {
  name: string;
  type?: string;
}

interface DistributionInputsProps {
  measure: string | undefined;
  binCount: number;
  groupDim: string | undefined;
  numericMeasures: Member[];
  categoricalDims: Member[];
  onMeasureChange: (value: string | undefined) => void;
  onBinCountChange: (value: number) => void;
  onGroupDimChange: (value: string | undefined) => void;
}

function shortName(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1] || name;
}

export function DistributionInputs({
  measure,
  binCount,
  groupDim,
  numericMeasures,
  categoricalDims,
  onMeasureChange,
  onBinCountChange,
  onGroupDimChange,
}: DistributionInputsProps) {
  return (
    <InputsRow>
      <Flow>
        <Paragraph preset="c1m">Measure</Paragraph>
        <Select
          showSearch
          placeholder="Pick a measure"
          style={{ width: '100%' }}
          value={measure}
          options={numericMeasures.map((m) => ({ value: m.name, label: shortName(m.name) }))}
          onChange={(v) => onMeasureChange(v)}
        />
      </Flow>
      <Flow>
        <Paragraph preset="c1m">Bins</Paragraph>
        <InputNumber
          min={2}
          max={50}
          value={binCount}
          onChange={(v) => onBinCountChange(Number(v) || 10)}
        />
      </Flow>
      <Flow>
        <Paragraph preset="c1m">Group by (optional)</Paragraph>
        <Select
          allowClear
          showSearch
          placeholder="—"
          style={{ width: '100%' }}
          value={groupDim}
          options={categoricalDims.map((d) => ({ value: d.name, label: shortName(d.name) }))}
          onChange={(v) => onGroupDimChange(v)}
        />
      </Flow>
    </InputsRow>
  );
}
