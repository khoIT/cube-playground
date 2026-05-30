/**
 * Add-connector source catalog. A search box + category filter chips over a
 * grid of source types (Warehouse / MMP / Ad Networks / Others). Picking a
 * source opens the credentials form. v1 connectors are config-seeded
 * server-side, so this is an honest "request a source" catalog — selecting a
 * tile routes to an informational credentials screen, it does not provision.
 */
import { ReactElement, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Search } from 'lucide-react';

type Category = 'warehouse' | 'mmp' | 'adnetworks' | 'others';

interface Source {
  id: string;
  label: string;
  badge: string;
  category: Category;
}

const SOURCES: Source[] = [
  { id: 'bigquery', label: 'BigQuery', badge: 'Bi', category: 'warehouse' },
  { id: 'snowflake', label: 'Snowflake', badge: 'Sn', category: 'warehouse' },
  { id: 'redshift', label: 'Redshift', badge: 'Re', category: 'warehouse' },
  { id: 'postgres', label: 'PostgreSQL', badge: 'Po', category: 'warehouse' },
  { id: 'databricks', label: 'Databricks', badge: 'Da', category: 'warehouse' },
  { id: 'clickhouse', label: 'ClickHouse', badge: 'Cl', category: 'warehouse' },
  { id: 'trino', label: 'Trino / Presto', badge: 'Tr', category: 'warehouse' },
  { id: 'aurora', label: 'Amazon Aurora', badge: 'Am', category: 'warehouse' },
  { id: 'mysql', label: 'MySQL', badge: 'My', category: 'warehouse' },
  { id: 'mongodb', label: 'MongoDB', badge: 'Mo', category: 'warehouse' },
  { id: 'appsflyer', label: 'AppsFlyer', badge: 'Ap', category: 'mmp' },
  { id: 'adjust', label: 'Adjust', badge: 'Ad', category: 'mmp' },
  { id: 'singular', label: 'Singular', badge: 'Si', category: 'mmp' },
  { id: 'branch', label: 'Branch', badge: 'Br', category: 'mmp' },
  { id: 'meta-ads', label: 'Meta Ads', badge: 'Me', category: 'adnetworks' },
  { id: 'google-ads', label: 'Google Ads', badge: 'Go', category: 'adnetworks' },
  { id: 'tiktok-ads', label: 'TikTok Ads', badge: 'Ti', category: 'adnetworks' },
  { id: 'unity-ads', label: 'Unity Ads', badge: 'Un', category: 'adnetworks' },
];

const CATEGORY_LABEL: Record<Category, string> = {
  warehouse: 'Warehouse',
  mmp: 'MMP',
  adnetworks: 'Ad Networks',
  others: 'Others',
};
const CATEGORY_ORDER: Category[] = ['warehouse', 'mmp', 'adnetworks', 'others'];

const SearchWrap = styled.div`
  position: relative;
  margin-bottom: 16px;
`;
const SearchInput = styled.input`
  width: 100%;
  height: 38px;
  padding: 0 12px 0 34px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  &:focus {
    outline: none;
    border-color: var(--brand);
  }
`;
const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
`;
const Chip = styled.button<{ $active: boolean }>`
  height: 30px;
  padding: 0 14px;
  border-radius: var(--radius-pill);
  border: 1px solid ${(p) => (p.$active ? 'transparent' : 'var(--border-card)')};
  background: ${(p) => (p.$active ? 'var(--text-primary)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--bg-card)' : 'var(--text-secondary)')};
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  &:hover {
    border-color: ${(p) => (p.$active ? 'transparent' : 'var(--brand)')};
  }
`;
const GroupLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin: 8px 0 10px;
`;
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
`;
const Tile = styled.button`
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  padding: 16px;
  cursor: pointer;
  font-family: var(--font-sans);
  text-align: left;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
  &:hover {
    box-shadow: var(--shadow-sm);
    border-color: var(--brand);
  }
`;
const TileBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
`;
const TileLabel = styled.span`
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-primary);
`;

interface Props {
  onPick: (source: { id: string; label: string }) => void;
}

export function AddConnector({ onPick }: Props): ReactElement {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Category | 'all'>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SOURCES.filter((s) => {
      if (filter !== 'all' && s.category !== filter) return false;
      if (q && !s.label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [query, filter]);

  const grouped = useMemo(() => {
    const map = new Map<Category, Source[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const s of filtered) map.get(s.category)?.push(s);
    return CATEGORY_ORDER.map((cat) => ({ cat, items: map.get(cat) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [filtered]);

  return (
    <>
      <SearchWrap>
        <Search
          size={15}
          style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }}
          aria-hidden
        />
        <SearchInput
          placeholder="Search sources…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </SearchWrap>

      <ChipRow role="tablist" aria-label="Source categories">
        <Chip type="button" $active={filter === 'all'} onClick={() => setFilter('all')}>
          All connectors ({SOURCES.length})
        </Chip>
        {CATEGORY_ORDER.map((cat) => (
          <Chip
            key={cat}
            type="button"
            $active={filter === cat}
            onClick={() => setFilter((f) => (f === cat ? 'all' : cat))}
          >
            {CATEGORY_LABEL[cat]}
          </Chip>
        ))}
      </ChipRow>

      {grouped.map((group) => (
        <section key={group.cat}>
          <GroupLabel>
            {CATEGORY_LABEL[group.cat]}
            {group.cat === 'warehouse' ? ' · instant connection' : ''}
          </GroupLabel>
          <Grid>
            {group.items.map((s) => (
              <Tile key={s.id} type="button" onClick={() => onPick({ id: s.id, label: s.label })}>
                <TileBadge aria-hidden>{s.badge}</TileBadge>
                <TileLabel>{s.label}</TileLabel>
              </Tile>
            ))}
          </Grid>
        </section>
      ))}

      {filtered.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
          No sources match “{query}”.
        </div>
      ) : null}
    </>
  );
}
