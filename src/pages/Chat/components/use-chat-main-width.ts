/**
 * Persisted width preference for the full-page /chat column.
 *
 * Two states: focused 70% reading column (default) ↔ full width, the latter
 * giving wide chart artifacts (funnels, multi-series bars) room to render
 * without horizontal cramping. The pref is device-portable and shared between
 * the page's max-width container and the header toggle chip via a common key,
 * so both re-render in step (server-prefs store fans out the change).
 *
 * Only consumed by the full-page chat; the docked right panel (ChatPanel) is a
 * separate render path and never reads this, so the toggle is naturally absent
 * there.
 */
import { useServerPref } from '../../../hooks/use-server-pref';

const KEY = 'gds-cube:chat-main:full-width';

/** `[isFull, toggle]` — isFull=true → full width, false → 70% column. */
export function useChatMainWidthFull(): [boolean, () => void] {
  const [isFull, setIsFull] = useServerPref<boolean>(KEY, false);
  return [isFull, () => setIsFull(!isFull)];
}

/** CSS max-width for the chat column given the current mode. */
export function chatColumnMaxWidth(isFull: boolean): string {
  return isFull ? '100%' : '70%';
}
