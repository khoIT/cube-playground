/**
 * Sidebar section expand state — per-section boolean persisted in localStorage.
 * Default: expanded (true). Custom event broadcasts changes across mounts.
 *
 * Also owns the path → section-id map used for auto-expanding the section
 * matching the active route (longest-prefix match).
 */
const KEY = (id: string) => `gds-cube:sidebar:section:${id}`;
const EVENT = 'gds-cube:sidebar-expand-changed';

export function getSectionExpanded(section: string): boolean {
  try {
    const v = localStorage.getItem(KEY(section));
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

export function setSectionExpanded(section: string, expanded: boolean): void {
  try { localStorage.setItem(KEY(section), expanded ? '1' : '0'); } catch { /* noop */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { section, expanded } })); } catch { /* noop */ }
}

export function onSectionExpandChange(handler: (section: string, expanded: boolean) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ section: string; expanded: boolean }>).detail;
    if (detail && typeof detail.section === 'string' && typeof detail.expanded === 'boolean') {
      handler(detail.section, detail.expanded);
    }
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

// Path-prefix → section-id map. Longest matching prefix wins so deeper
// routes (e.g. /segments/identity-map) override their parent (/segments).
const PATH_TO_SECTION: Array<{ prefix: string; sectionId: string }> = [
  { prefix: '/chat',                   sectionId: 'chats' },
  { prefix: '/build',                  sectionId: 'playground' },
  { prefix: '/catalog/data-model',     sectionId: 'data-model' },
  { prefix: '/data-model/new',         sectionId: 'data-model' },
  { prefix: '/catalog/metrics',        sectionId: 'metrics-catalog' },
  { prefix: '/catalog/metric',         sectionId: 'metrics-catalog' },
  { prefix: '/catalog/concept',        sectionId: 'data-model' },
  { prefix: '/segments',               sectionId: 'segments' },
  { prefix: '/liveops',                sectionId: 'liveops' },
  { prefix: '/dashboards',             sectionId: 'dashboards' },
];

export function getSidebarSectionForPath(pathname: string): string | null {
  let best: { prefix: string; sectionId: string } | null = null;
  for (const entry of PATH_TO_SECTION) {
    if (pathname === entry.prefix || pathname.startsWith(entry.prefix + '/')) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
  }
  return best?.sectionId ?? null;
}
