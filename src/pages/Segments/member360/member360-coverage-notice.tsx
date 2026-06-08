/**
 * Member360CoverageNotice — a calm, non-blocking banner on the 360 page that
 * tells a viewer WHY some sections may be sparse: the game's 360 coverage isn't
 * fully ready in the active workspace.
 *
 * Renders nothing when the game is fully `ready` (no noise on the happy path),
 * `na` (no config — the page already shows its own unavailable state), or while
 * loading. For partial/empty/blocked/error it lists the affected surfaces and
 * the reason, so the dashboard reads as "limited", not "broken".
 *
 * Reuses the shared coverage hook (one server-cached fetch); tokens only.
 */

import { ReactElement } from 'react';
import { Info } from 'lucide-react';

import { useWorkspaceContext } from '../../../components/workspace-context';
import {
  useMember360Coverage,
  findGameCoverage,
  type PanelCoverage,
} from '../../../hooks/use-member360-coverage';

interface Props {
  gameId: string | null;
}

function reasonFor(p: PanelCoverage): string {
  switch (p.status) {
    case 'blocked':
      return 'not modeled yet';
    case 'partial':
      return `missing ${p.missingMembers.length} field${p.missingMembers.length === 1 ? '' : 's'}`;
    case 'empty':
      return 'no data yet';
    case 'error':
      return 'unavailable';
    default:
      return '';
  }
}

export function Member360CoverageNotice({ gameId }: Props): ReactElement | null {
  const { workspaceId } = useWorkspaceContext();
  const { report } = useMember360Coverage(workspaceId);
  const gc = findGameCoverage(report, gameId);

  // Happy path / no-config / still loading → say nothing.
  if (!gc || gc.status === 'ready' || gc.status === 'na') return null;
  const limited = gc.panels.filter((p) => p.status !== 'ready');
  if (limited.length === 0) return null;

  return (
    <div
      role="status"
      data-testid="member360-coverage-notice"
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        background: 'var(--info-soft)',
        color: 'var(--info-ink)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-md)',
        padding: '10px 14px',
        marginBottom: 16,
        fontSize: 12.5,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <Info size={15} aria-hidden style={{ marginTop: 1, flexShrink: 0 }} />
      <div>
        <strong>Some 360 sections are limited.</strong> A few surfaces aren’t
        fully available for this game in the current workspace:{' '}
        {limited.map((p, i) => (
          <span key={p.view}>
            {i > 0 ? ', ' : ''}
            <strong>{p.title}</strong> ({reasonFor(p)})
          </span>
        ))}
        . Sections below render with whatever data is available.
      </div>
    </div>
  );
}

export default Member360CoverageNotice;
