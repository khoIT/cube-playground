/**
 * Shared formatting helpers for the Case Ledger surfaces (queue + sweeps lens),
 * so the VIP identity cell renders consistently wherever a profile is shown.
 */

import { formatValue } from '../../Segments/detail/cards/format-value';

/** "₫10.18M" compact currency; em-dash when the LTV is unknown. */
export function ltvLabel(vnd: number | null): string {
  return vnd == null ? '—' : formatValue(vnd, 'currency');
}
