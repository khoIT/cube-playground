/**
 * Reference panels — the rest of the 360 (monetization, profile, acquisition,
 * journey, detail tabs) folded into concise, collapsed-by-default cards so a CS
 * agent can glance at context without leaving the care timeline. Each panel
 * reuses the existing Segments member-360 section components verbatim — same
 * live Cube data, just wrapped in a toggle.
 *
 * Tokens only; mirrors the SectionCard chrome used across member-360.
 */

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { sectionsForGame } from '../../../Segments/member360/member360-sections';
import { MonetizationBand } from '../../../Segments/member360/sections/monetization-band';
import { ProfileStatusGroups } from '../../../Segments/member360/sections/profile-status-groups';
import { AcquisitionStrip } from '../../../Segments/member360/sections/acquisition-strip';
import { DashboardJourney } from '../../../Segments/member360/sections/dashboard-journey';
import { DetailsTabs } from '../../../Segments/member360/sections/details-tabs';

type Sections = NonNullable<ReturnType<typeof sectionsForGame>>;

interface CollapsibleProps {
  icon: string;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Collapsible({ icon, title, defaultOpen = false, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%',
          padding: '12px 16px', border: 0, background: 'transparent', cursor: 'pointer',
          fontFamily: 'var(--font-sans)', textAlign: 'left',
        }}
      >
        <span aria-hidden style={{ fontSize: 15 }}>{icon}</span>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</span>
        <ChevronDown
          size={16}
          style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
        />
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border-card)' }}>
          <div style={{ paddingTop: 14 }}>{children}</div>
        </div>
      )}
    </div>
  );
}

interface ReferencePanelsProps {
  gameId: string;
  uid: string;
  sections: Sections;
  row: Record<string, unknown> | null;
  // useCachedPanelSource return — passed through to journey / detail tabs.
  cachedSource: React.ComponentProps<typeof DashboardJourney>['cachedSource'];
}

export function CsReferencePanels({ gameId, uid, sections, row, cachedSource }: ReferencePanelsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginTop: 4 }}>
        Member reference
      </div>

      <Collapsible icon="💰" title="Monetization">
        <MonetizationBand config={sections.monetization} row={row} />
      </Collapsible>

      <Collapsible icon="🪪" title="Profile & status">
        <ProfileStatusGroups groups={sections.profileGroups} statusChips={sections.statusChips} row={row} />
      </Collapsible>

      <Collapsible icon="📥" title="Acquisition">
        <AcquisitionStrip timeline={sections.acquisitionTimeline} chips={sections.acquisitionChips} row={row} />
      </Collapsible>

      <Collapsible icon="🧭" title="Activity & journey">
        <DashboardJourney gameId={gameId} uid={uid} sections={sections} row={row} cachedSource={cachedSource} />
      </Collapsible>

      <Collapsible icon="📊" title="Detailed breakdowns">
        <DetailsTabs gameId={gameId} uid={uid} cachedSource={cachedSource} />
      </Collapsible>
    </div>
  );
}
