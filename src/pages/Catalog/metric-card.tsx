/**
 * MetricCard — pure component rendering a single Cube measure as a first-class
 * detail surface. Driven entirely by `/meta` content: no fetches inside.
 *
 * Section order: Header → What it is → Where it lives → How to slice it →
 * CDP projection → Similar measures → Joinable with → Provenance → Footer
 * (Try-it / Copy-link). Each section is conditional on data: empty fields
 * skip the whole section, including its header.
 */

import { useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import type { CatalogCube, CatalogDimension, CatalogMeasure } from './use-catalog-meta';
import { buildTryItUrl, DEFAULT_RANGE } from './try-it-url';
import {
  Section,
  SectionTitle,
  Description,
  KvRow,
  KvLabel,
  Code,
  Chip,
  Container,
  Header,
  Fqn,
  Subtitle,
  ChipRow,
  WizardChip,
  Footer,
  PrimaryBtn,
  SecondaryBtn,
} from './metric-card-styles';
import { MetricCardHowToSlice } from './metric-card-how-to-slice';
import { MetricCardSimilarMeasures } from './metric-card-similar-measures';
import { MetricCardJoinableWith } from './metric-card-joinable-with';
import { CdpProjectionCard } from './cdp-projection/cdp-projection-card';
import { projectMeasure } from './cdp-projection/project-measure';
import type { ProjectableCube, ProjectableMeasure } from './cdp-projection/types';

interface MetricCardProps {
  cube: CatalogCube;
  measure: CatalogMeasure;
  allCubes: CatalogCube[];
}

function primaryTimeDim(cube: CatalogCube): CatalogDimension | null {
  return cube.dimensions.find((d) => d.type === 'time' && d.public !== false) ?? null;
}

function shortDim(name: string): string {
  const dot = name.indexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : name;
}

function clusterLabel(cube: CatalogCube): string {
  if (typeof cube.connectedComponent === 'number') {
    return `Connected · cluster ${cube.connectedComponent}`;
  }
  return 'Standalone';
}

function provenanceText(measure: CatalogMeasure): string | null {
  const source = measure.meta?.source;
  if (!source) return null;
  const author = measure.meta?.author;
  if (author) return `Authored by ${String(author)} via ${String(source)}`;
  return `Authored via ${String(source)}`;
}

export function MetricCard({ cube, measure, allCubes }: MetricCardProps) {
  const history = useHistory();
  const isWizard = measure.meta?.source === 'wizard';
  const provenance = provenanceText(measure);
  const [copied, setCopied] = useState(false);

  const cubesByName = useMemo(() => {
    const map = new Map<string, CatalogCube>();
    for (const c of allCubes) map.set(c.name, c);
    return map;
  }, [allCubes]);

  const projection = projectMeasure(
    cube as unknown as ProjectableCube,
    measure as unknown as ProjectableMeasure,
  );

  const timeDim = primaryTimeDim(cube);
  const tryItLabel = timeDim
    ? `Try it: by ${shortDim(timeDim.name)}, last 30 days`
    : 'Try it: count';

  function handleTryIt() {
    history.push(
      buildTryItUrl({
        cube: cube.name,
        measure: measure.name,
        timeFqn: timeDim ? timeDim.name : undefined,
        range: timeDim ? DEFAULT_RANGE : undefined,
      }),
    );
  }

  function handleCopyLink() {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(window.location.href);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Container data-testid="metric-card" data-fqn={measure.name}>
      <Header>
        <Fqn>{measure.name}</Fqn>
        {measure.title && <Subtitle>{measure.title}</Subtitle>}
        <ChipRow>
          {measure.aggType && <Chip>{measure.aggType}</Chip>}
          {measure.format && <Chip>{measure.format}</Chip>}
          {isWizard && <WizardChip>Wizard</WizardChip>}
        </ChipRow>
      </Header>

      {measure.description && (
        <Section>
          <SectionTitle>What it is</SectionTitle>
          <Description>{measure.description}</Description>
        </Section>
      )}

      <Section>
        <SectionTitle>Where it lives</SectionTitle>
        <KvRow>
          <KvLabel>Cube</KvLabel>
          <Code>{cube.name}</Code>
        </KvRow>
        <KvRow>
          <KvLabel>Cluster</KvLabel>
          <span>{clusterLabel(cube)}</span>
        </KvRow>
        {cube.description && (
          <KvRow>
            <KvLabel>About cube</KvLabel>
            <Description>{cube.description}</Description>
          </KvRow>
        )}
      </Section>

      <MetricCardHowToSlice cube={cube} />

      {projection.ok && (
        <Section>
          <SectionTitle>CDP projection</SectionTitle>
          <CdpProjectionCard projection={projection} />
        </Section>
      )}

      <MetricCardSimilarMeasures cube={cube} measure={measure} />

      <MetricCardJoinableWith cube={cube} cubesByName={cubesByName} />

      {provenance && (
        <Section>
          <SectionTitle>Provenance</SectionTitle>
          <Description>{provenance}</Description>
        </Section>
      )}

      <Footer>
        <SecondaryBtn type="button" onClick={handleCopyLink}>
          {copied ? 'Copied!' : 'Copy link'}
        </SecondaryBtn>
        <PrimaryBtn type="button" onClick={handleTryIt}>
          {tryItLabel} →
        </PrimaryBtn>
      </Footer>
    </Container>
  );
}
