import styled from 'styled-components';
import { LivePreviewStatus } from '../hooks/use-live-preview';
import { ScalarTile } from './scalar-tile';
import { Sparkline } from './sparkline';

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Status = styled.div<{ $kind: 'info' | 'error' }>`
  font-size: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-pill);
  background: ${(p) =>
    p.$kind === 'error'
      ? 'rgba(239, 68, 68, 0.08)'
      : 'rgba(63, 141, 255, 0.08)'};
  color: ${(p) => (p.$kind === 'error' ? 'var(--danger)' : 'var(--info)')};
`;

interface LivePreviewCardProps {
  status: LivePreviewStatus;
  scalar: number | null;
  series: Array<{ x: string; y: number }> | null;
  error: string | null;
  measureLabel: string;
  hasTimeDim: boolean;
}

function statusMessage(status: LivePreviewStatus): string | null {
  switch (status) {
    case 'idle':
      return 'Choose a time dimension to preview.';
    case 'discarding-prior':
      return 'Discarding previous draft…';
    case 'writing':
      return 'Writing YAML…';
    case 'loading':
      return 'Loading preview…';
    default:
      return null;
  }
}

export function LivePreviewCard({
  status,
  scalar,
  series,
  error,
  measureLabel,
  hasTimeDim,
}: LivePreviewCardProps) {
  const busy = statusMessage(status);

  return (
    <Stack>
      {error && <Status $kind="error">{error}</Status>}
      {busy && !error && <Status $kind="info">{busy}</Status>}

      <ScalarTile label={measureLabel} value={scalar} />

      {hasTimeDim ? (
        <Sparkline data={series ?? []} />
      ) : (
        <Status $kind="info">
          No time dimension on this cube — sparkline disabled.
        </Status>
      )}
    </Stack>
  );
}
