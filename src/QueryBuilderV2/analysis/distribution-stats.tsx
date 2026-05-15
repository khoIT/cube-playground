import { Paragraph, tasty } from '@cube-dev/ui-kit';

import { Summary } from './distribution-bucket';

const StatsRow = tasty({
  styles: {
    display: 'grid',
    gridColumns: 'repeat(5, max-content)',
    gap: '2x',
    padding: '.5x 1x',
    fill: '#light',
    radius: true,
  },
});

const StatBlock = tasty({
  styles: {
    display: 'flex',
    flow: 'column',
    gap: '.25x',
    color: { '': '#dark-02', Label: '#dark-03' },
  },
});

function formatStat(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

interface DistributionStatsProps {
  stats: Summary | null;
}

export function DistributionStats({ stats }: DistributionStatsProps) {
  return (
    <StatsRow>
      <StatBlock>
        <Paragraph data-element="Label" preset="c2">Min</Paragraph>
        <Paragraph preset="t3m">{formatStat(stats?.min)}</Paragraph>
      </StatBlock>
      <StatBlock>
        <Paragraph data-element="Label" preset="c2">Max</Paragraph>
        <Paragraph preset="t3m">{formatStat(stats?.max)}</Paragraph>
      </StatBlock>
      <StatBlock>
        <Paragraph data-element="Label" preset="c2">Mean</Paragraph>
        <Paragraph preset="t3m">{formatStat(stats?.mean)}</Paragraph>
      </StatBlock>
      <StatBlock>
        <Paragraph data-element="Label" preset="c2">Median</Paragraph>
        <Paragraph preset="t3m">{formatStat(stats?.median)}</Paragraph>
      </StatBlock>
      <StatBlock>
        <Paragraph data-element="Label" preset="c2">N</Paragraph>
        <Paragraph preset="t3m">{stats?.total.toLocaleString() ?? '0'}</Paragraph>
      </StatBlock>
    </StatsRow>
  );
}
