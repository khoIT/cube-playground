import styled from 'styled-components';
import { useHistory } from 'react-router-dom';
import { CatalogCube } from './use-catalog-meta';
import { DetailPanelMeasures } from './detail-panel-measures';

const Panel = styled.aside`
  width: 480px;
  flex-shrink: 0;
  background: var(--bg-card);
  border-left: 1px solid var(--border-card);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

const Header = styled.header`
  padding: 20px 24px 12px;
  border-bottom: 1px solid var(--border-card);
  display: flex;
  justify-content: space-between;
  align-items: baseline;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--text-primary);
`;

const CloseBtn = styled.button`
  appearance: none;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 16px;

  &:hover {
    color: var(--text-primary);
  }
`;

const Section = styled.section`
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-card);
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SectionTitle = styled.h3`
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const Description = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
`;

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 4px 0;
`;

const Code = styled.code`
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-primary);
`;

const Chip = styled.span`
  display: inline-flex;
  padding: 1px 6px;
  border-radius: var(--pill-mono-radius);
  background: var(--pill-mono-bg);
  font-size: 10.5px;
  color: var(--text-secondary);
  margin-left: 6px;
`;

const Footer = styled.div`
  padding: 16px 24px;
  border-top: 1px solid var(--border-card);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const PrimaryBtn = styled.button`
  appearance: none;
  cursor: pointer;
  background: var(--brand);
  color: var(--text-on-brand);
  border: 0;
  border-radius: var(--radius-pill);
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;

  &:hover {
    background: var(--brand-hover);
  }
`;

interface DetailPanelProps {
  cube: CatalogCube;
  onClose: () => void;
}

export function DetailPanel({ cube, onClose }: DetailPanelProps) {
  const history = useHistory();

  function openInPlayground() {
    history.push(`/build?cube=${encodeURIComponent(cube.name)}`);
  }

  return (
    <Panel role="dialog" aria-label={`${cube.name} details`}>
      <Header>
        <Title>{cube.name}</Title>
        <CloseBtn type="button" aria-label="Close details" onClick={onClose}>
          ✕
        </CloseBtn>
      </Header>

      {cube.description && (
        <Section>
          <SectionTitle>Description</SectionTitle>
          <Description>{cube.description}</Description>
        </Section>
      )}

      {cube.joins && cube.joins.length > 0 && (
        <Section>
          <SectionTitle>Joins ({cube.joins.length})</SectionTitle>
          {cube.joins.map((j) => (
            <Row key={j.name}>
              <Code>{j.name}</Code>
              <Code>{j.sql}</Code>
            </Row>
          ))}
        </Section>
      )}

      <DetailPanelMeasures cube={cube} />

      <Section>
        <SectionTitle>Dimensions ({cube.dimensions.length})</SectionTitle>
        {cube.dimensions.map((d) => (
          <Row key={d.name}>
            <span>
              <Code>{d.name.split('.').slice(1).join('.') || d.name}</Code>
              {d.type && <Chip>{d.type}</Chip>}
              {d.primaryKey && <Chip>PK</Chip>}
              {d.public === false && <Chip>hidden</Chip>}
            </span>
          </Row>
        ))}
      </Section>

      {cube.preAggregations && cube.preAggregations.length > 0 && (
        <Section>
          <SectionTitle>Pre-aggregations</SectionTitle>
          {cube.preAggregations.map((pa) => (
            <Row key={pa.name}>
              <Code>{pa.name}</Code>
              {pa.granularity && <Chip>{pa.granularity}</Chip>}
            </Row>
          ))}
        </Section>
      )}

      <Footer>
        <PrimaryBtn type="button" onClick={openInPlayground}>
          Open in Playground →
        </PrimaryBtn>
      </Footer>
    </Panel>
  );
}
