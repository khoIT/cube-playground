/**
 * Settings → Metric coverage. Reconciles the business-metrics registry against
 * each game's live Cube /meta. Three gap views, each collapsible, all scoped
 * by the game-filter chips:
 *   • Broken refs        — registry metric refs that don't resolve (per game).
 *   • Uncovered measures — /meta measures with no metric (scaffold candidates).
 *   • Availability matrix — metric × game grid.
 *
 * Source-of-truth note: matrix rows come from the curated registry; uncovered
 * measures come from cube-dev /meta. The gap between the two is the point.
 */
import { ReactElement, useMemo, useState } from 'react';
import styled from 'styled-components';
import { RefreshCw, PackagePlus } from 'lucide-react';

import { SectionCard, SectionHead, SectionTitle, SectionHint } from './section-card';
import { MetricCoverageMatrix } from './metric-coverage-matrix';
import { useMetricCoverage } from './use-metric-coverage';
import { Collapsible, GameFilterChips, Pill, Mono, Note } from './coverage-ui';

const Btn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  &:hover:not(:disabled) { color: var(--brand); border-color: var(--brand); background: var(--brand-soft); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const Row = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 4px;
  font-size: 12.5px;
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  &:hover { background: var(--bg-muted); }
`;

const PillBar = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 14px 0 4px;
`;

const FilterRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

export function MetricCoverageSection(): ReactElement {
  const { report, loading, error, refetch, scaffold } = useMetricCoverage();
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [selectedMeasures, setSelectedMeasures] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  // Empty selection means "all games" — avoids a seeding effect (which would
  // race each section's defaultOpen) and naturally handles async report load.
  const allGameIds = useMemo(() => report?.games.map((g) => g.game) ?? [], [report]);
  const activeGameIds = useMemo(
    () => (selectedGames.size > 0 ? selectedGames : new Set(allGameIds)),
    [selectedGames, allGameIds],
  );

  const games = useMemo(
    () => (report?.games ?? []).filter((g) => activeGameIds.has(g.game)),
    [report, activeGameIds],
  );

  // Uncovered measures across the *filtered* games (union).
  const uncovered = useMemo(() => {
    const s = new Set<string>();
    for (const g of games) for (const m of g.uncoveredMeasures) s.add(m);
    return [...s].sort();
  }, [games]);

  const brokenMetricCount = useMemo(() => {
    const ids = new Set<string>();
    for (const g of games) for (const b of g.brokenRefs) ids.add(b.metricId);
    return ids.size;
  }, [games]);

  const toggleGame = (id: string) =>
    setSelectedGames((prev) => {
      // Expand the implicit "all" state to explicit before removing one.
      const next = prev.size > 0 ? new Set(prev) : new Set(allGameIds);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const selectAllGames = () => setSelectedGames(new Set()); // empty = all

  const toggleMeasure = (ref: string) =>
    setSelectedMeasures((prev) => {
      const next = new Set(prev);
      next.has(ref) ? next.delete(ref) : next.add(ref);
      return next;
    });

  const handleScaffold = async () => {
    if (selectedMeasures.size === 0) return;
    setBusy(true);
    setLastResult(null);
    try {
      const r = await scaffold([...selectedMeasures]);
      setSelectedMeasures(new Set());
      setLastResult(`Created ${r.created.length} draft(s)${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}.`);
    } catch (err) {
      setLastResult(`Scaffold failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard>
      <SectionHead>
        <div>
          <SectionTitle>Metric coverage</SectionTitle>
          <SectionHint>
            Curated business metrics (registry) checked against each game's live Cube model. Matrix
            rows are registry metrics; “uncovered” are cube measures with no metric yet.
          </SectionHint>
        </div>
        <Btn type="button" onClick={() => void refetch()} disabled={loading}>
          <RefreshCw size={13} /> {loading ? 'Syncing…' : 'Refresh'}
        </Btn>
      </SectionHead>

      {error ? <Pill $tone="danger">Failed to load: {error}</Pill> : null}

      {report ? (
        <>
          <FilterRow>
            <GameFilterChips
              games={report.games.map((g) => ({ id: g.game, status: g.status }))}
              selected={activeGameIds}
              onToggle={toggleGame}
              onAll={selectAllGames}
            />
          </FilterRow>

          <PillBar>
            <Pill $tone={brokenMetricCount ? 'danger' : 'ok'}>{brokenMetricCount} broken metric(s)</Pill>
            <Pill $tone={uncovered.length ? 'warn' : 'ok'}>{uncovered.length} uncovered measure(s)</Pill>
            <Pill $tone="muted">{games.length} game(s)</Pill>
          </PillBar>

          {/* Broken refs — one nested disclosure per game. */}
          <Collapsible
            title="Broken refs"
            defaultOpen={brokenMetricCount > 0}
            meta={<Pill $tone={brokenMetricCount ? 'danger' : 'ok'}>{brokenMetricCount}</Pill>}
          >
            {games.map((g) => (
              <Collapsible
                key={g.game}
                title={g.game}
                meta={
                  <Pill $tone={g.status === 'error' ? 'warn' : g.brokenRefs.length ? 'danger' : 'ok'}>
                    {g.status === 'error' ? 'meta error' : `${g.brokenRefs.length} broken`}
                  </Pill>
                }
              >
                {g.status === 'error' ? (
                  <Note>{g.error ?? 'meta unavailable'}</Note>
                ) : g.brokenRefs.length === 0 ? (
                  <Note>All refs resolve.</Note>
                ) : (
                  g.brokenRefs.map((b) => (
                    <Note key={`${b.metricId}.${b.ref}`}>
                      {b.metricId} → <Mono>{b.ref}</Mono> ({b.reason})
                    </Note>
                  ))
                )}
              </Collapsible>
            ))}
          </Collapsible>

          {/* Uncovered measures — scaffold candidates from cube-dev /meta. */}
          <Collapsible
            title="Uncovered measures"
            meta={<Pill $tone={uncovered.length ? 'warn' : 'ok'}>{uncovered.length}</Pill>}
          >
            {uncovered.length === 0 ? (
              <Note>Every cube measure (in the selected games) is covered by a metric.</Note>
            ) : (
              <>
                {uncovered.map((ref) => (
                  <Row key={ref}>
                    <input
                      type="checkbox"
                      checked={selectedMeasures.has(ref)}
                      onChange={() => toggleMeasure(ref)}
                    />
                    <Mono>{ref}</Mono>
                  </Row>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <Btn type="button" onClick={handleScaffold} disabled={busy || selectedMeasures.size === 0}>
                    <PackagePlus size={13} /> {busy ? 'Scaffolding…' : `Scaffold ${selectedMeasures.size} draft(s)`}
                  </Btn>
                  {lastResult ? <Note style={{ margin: 0 }}>{lastResult}</Note> : null}
                </div>
                <Note>Creates <Mono>trust: draft</Mono> metric YAMLs for curation — review before promoting.</Note>
              </>
            )}
          </Collapsible>

          {/* Availability matrix — columns scoped to the selected games. */}
          <Collapsible title="Availability matrix" defaultOpen>
            <MetricCoverageMatrix games={games} matrix={report.matrix} />
          </Collapsible>
        </>
      ) : (
        !error && <Note>Loading coverage…</Note>
      )}
    </SectionCard>
  );
}

export default MetricCoverageSection;
