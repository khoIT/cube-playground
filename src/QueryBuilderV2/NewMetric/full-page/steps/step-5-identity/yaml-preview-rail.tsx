import { useMemo } from 'react';
import styled from 'styled-components';
import type { NewMetricDraftV3 } from '../../../types';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import { generateEntry } from '../../../yaml/generate-cube-entry';
import { KindBadge } from '../../../components/kind-badge';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;
const SectionHeader = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: var(--text-muted);
`;
const Block = styled.pre`
  background: var(--bg-muted);
  border: 1px solid var(--border-card);
  border-radius: 10px;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-primary);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 70vh;
  overflow-y: auto;
`;

const TOKEN_COLOR_KEY = '#9a3412';
const TOKEN_COLOR_STRING = '#047857';
const TOKEN_COLOR_PUNCT = 'var(--text-muted)';

type Tok = { text: string; color?: string };

function tokenizeLine(line: string): Tok[] {
  const tokens: Tok[] = [];
  const colonIdx = line.indexOf(':');
  if (colonIdx > 0 && line.trim().startsWith('-') === false) {
    const lead = line.slice(0, colonIdx);
    const rest = line.slice(colonIdx);
    tokens.push({ text: lead, color: TOKEN_COLOR_KEY });
    tokens.push({ text: ':', color: TOKEN_COLOR_PUNCT });
    for (const t of colourRest(rest.slice(1))) tokens.push(t);
  } else {
    for (const t of colourRest(line)) tokens.push(t);
  }
  return tokens;
}

function colourRest(s: string): Tok[] {
  if (!s) return [];
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'" || ch === '"') {
      const end = s.indexOf(ch, i + 1);
      if (end < 0) {
        out.push({ text: s.slice(i), color: TOKEN_COLOR_STRING });
        return out;
      }
      out.push({ text: s.slice(i, end + 1), color: TOKEN_COLOR_STRING });
      i = end + 1;
    } else {
      let j = i;
      while (j < s.length && s[j] !== "'" && s[j] !== '"') j++;
      out.push({ text: s.slice(i, j) });
      i = j;
    }
  }
  return out;
}

export type YamlPreviewRailProps = {
  draft: NewMetricDraftV3;
  sourceCube: WizardCube | null;
};

export function YamlPreviewRail({ draft, sourceCube }: YamlPreviewRailProps) {
  const emit = useMemo(() => {
    const primaryCube = draft.sourceCubes[0] ?? null;
    if (!primaryCube) return null;
    try {
      return generateEntry(draft, {
        sourceCube: primaryCube,
        reachableMembers: [],
        peerMeasureNames: (sourceCube?.measures ?? []).map((m) => m.name.split('.').slice(-1)[0]),
        createdAt: '2026-05-17T15:00:00.000Z',
      });
    } catch (err) {
      return { yaml: `# emit error: ${err instanceof Error ? err.message : String(err)}`, fragment: '', sectionKey: 'measures' as const };
    }
  }, [draft, sourceCube]);

  if (!emit) {
    return <Wrap><Block># Pick a source cube to preview YAML.</Block></Wrap>;
  }

  return (
    <Wrap>
      <SectionHeader>
        <KindBadge kind={draft.artifactKind} />
        <span>{emit.sectionKey} preview</span>
      </SectionHeader>
      <Block>
        {emit.yaml.split('\n').map((line, i) => (
          <div key={i}>
            {tokenizeLine(line).map((t, j) => (
              <span key={j} style={{ color: t.color ?? 'inherit' }}>{t.text}</span>
            ))}
          </div>
        ))}
      </Block>
    </Wrap>
  );
}
