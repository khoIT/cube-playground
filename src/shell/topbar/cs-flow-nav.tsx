/**
 * CS flow-nav in the Topbar — lifts the 3-step wayfinding bar (CS Monitor →
 * Case Ledger / Queue → Member-360 Care) out of each CS page body and into the
 * global Topbar's leading slot, matching the flow prototype where the flow-map
 * lives in the top bar rather than the content column.
 *
 * Route-driven (not page-registered): the active step is derived from the URL
 * and the game from useGameContext, so there is no KeepAlive stale-registration
 * concern. Returns null off the three flow surfaces (including the playbooks
 * editor and every non-CS route), where the Topbar falls back to the Breadcrumb.
 */
import { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useGameContext } from '../../components/Header/use-game-context';
import { CsConsoleNav, CsConsoleStep } from '../../pages/Dashboards/cs/cs-console-nav';

/** Map a pathname to its flow step, or null when the route is not a flow surface. */
function stepForPath(pathname: string): CsConsoleStep | null {
  if (pathname === '/dashboards/cs') return 'monitor';
  if (pathname.startsWith('/dashboards/cs/queue')) return 'queue';
  if (pathname.startsWith('/dashboards/cs/members/')) return 'member';
  // /dashboards/cs/playbooks/* (editor) and all non-CS routes have no step.
  return null;
}

/**
 * The Topbar leading node for CS flow surfaces, or null elsewhere. Consumed by
 * <Topbar> as `{csNav ?? <Breadcrumb/>}`.
 */
export function useCsFlowNav(): ReactNode | null {
  const { pathname } = useLocation();
  const { gameId } = useGameContext();
  const step = stepForPath(pathname);
  if (!step) return null;
  return <CsConsoleNav current={step} gameId={gameId} variant="topbar" />;
}
