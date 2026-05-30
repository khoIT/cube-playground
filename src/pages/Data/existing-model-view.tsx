/**
 * Read-only render of the existing committed cube model (the worked example).
 * Shows each cube with its dimensions / measures / joins so a DA can see what a
 * well-formed model looks like before building one for a new source. Authoring
 * view (YAML on disk), not the compiled /meta view — stated in the caption.
 * Styling via design tokens; mirrors the triage field-row look.
 */
import { ReactElement, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Boxes, KeyRound, Ruler, Link2 } from 'lucide-react';
import { onboardingClient } from '../../api/onboarding-client';
import type { ExistingModel, ExistingCube } from '../../api/onboarding-client';

const Caption = styled.p`
  margin: 0 0 16px;
  font-size: 12.5px;
  color: var(--text-muted);
  max-width: 64ch;
`;
const CubeCard = styled.div`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
  margin-bottom: 14px;
`;
const CubeHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
`;
const CubeName = styled.h3`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
`;
const SqlTable = styled.code`
  font-size: 11.5px;
  color: var(--text-muted);
  background: var(--bg-muted);
  padding: 2px 7px;
  border-radius: var(--radius-sm);
`;
const Desc = styled.p`
  margin: 6px 0 12px;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.5;
`;
const Section = styled.div`
  margin-top: 10px;
`;
const SectionLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin-bottom: 6px;
`;
const Rows = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;
const Pill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-app);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  padding: 3px 10px;
`;
const TypeTag = styled.span`
  font-size: 10.5px;
  color: var(--text-muted);
`;
const Empty = styled.div`
  padding: 32px 0;
  font-size: 13px;
  color: var(--text-muted);
`;

function CubeBlock({ cube }: { cube: ExistingCube }): ReactElement {
  return (
    <CubeCard>
      <CubeHead>
        <Boxes size={16} style={{ color: 'var(--brand)' }} aria-hidden />
        <CubeName>{cube.title || cube.name}</CubeName>
        <SqlTable>{cube.sqlTable || cube.name}</SqlTable>
      </CubeHead>
      {cube.description ? <Desc>{cube.description}</Desc> : null}

      <Section>
        <SectionLabel><Ruler size={12} /> Dimensions · {cube.dimensions.length}</SectionLabel>
        <Rows>
          {cube.dimensions.map((d) => (
            <Pill key={d.name}>
              {d.primaryKey ? <KeyRound size={11} style={{ color: 'var(--brand)' }} aria-label="primary key" /> : null}
              {d.name}
              <TypeTag>{d.type}</TypeTag>
            </Pill>
          ))}
        </Rows>
      </Section>

      <Section>
        <SectionLabel><Ruler size={12} /> Measures · {cube.measures.length}</SectionLabel>
        <Rows>
          {cube.measures.map((m) => (
            <Pill key={m.name}>
              {m.name}
              <TypeTag>{m.type}</TypeTag>
            </Pill>
          ))}
        </Rows>
      </Section>

      {cube.joins.length > 0 ? (
        <Section>
          <SectionLabel><Link2 size={12} /> Joins · {cube.joins.length}</SectionLabel>
          <Rows>
            {cube.joins.map((j) => (
              <Pill key={j.name}>
                {j.name}
                <TypeTag>{j.relationship}</TypeTag>
              </Pill>
            ))}
          </Rows>
        </Section>
      ) : null}
    </CubeCard>
  );
}

export function ExistingModelView({ game }: { game: string }): ReactElement {
  const [model, setModel] = useState<ExistingModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    onboardingClient
      .exampleModel(game)
      .then((m) => alive && (setModel(m), setError(null)))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [game]);

  if (loading) return <Empty>Reading existing model…</Empty>;
  if (error) return <Empty>Could not read model: {error}</Empty>;
  if (!model || !model.configured) {
    return <Empty>Model source not mounted (set VITE_CUBE_MODEL_DIR) — nothing to show for “{game}”.</Empty>;
  }
  if (model.cubes.length === 0) return <Empty>No cubes modeled for “{game}” yet.</Empty>;

  return (
    <>
      <Caption>
        The committed cube model for <strong>{game}</strong> — {model.cubes.length} cube
        {model.cubes.length === 1 ? '' : 's'}, read-only. This is the authoring view (YAML on disk);
        it’s the shape a new source’s model converges toward.
      </Caption>
      {model.cubes.map((c) => (
        <CubeBlock key={c.name} cube={c} />
      ))}
    </>
  );
}
