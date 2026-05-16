import { PrismCode, Space, Text } from '@cube-dev/ui-kit';
import { NewMetricDraft } from '../types';
import { ReachableMember } from '../hooks/use-reachable-members';
import { useMetricYaml } from '../hooks/use-metric-yaml';

interface YamlPreviewProps {
  draft: NewMetricDraft;
  sourceCube: string;
  reachableMembers: ReachableMember[];
  peerMeasureNames: string[];
}

/**
 * Live YAML preview panel — regenerates on every draft change via useMetricYaml.
 */
export function YamlPreview({
  draft,
  sourceCube,
  reachableMembers,
  peerMeasureNames,
}: YamlPreviewProps) {
  const { yaml, error } = useMetricYaml(draft, {
    sourceCube,
    reachableMembers,
    peerMeasureNames,
  });

  return (
    <Space direction="vertical" gap="1x">
      <Text preset="t3m" style={{ color: 'var(--text-secondary)' }}>
        YAML preview
      </Text>

      {error && (
        <Text preset="t4" style={{ color: 'var(--danger-text, #f5222d)' }}>
          {error}
        </Text>
      )}

      {!error && yaml ? (
        <PrismCode code={yaml} language="yaml" />
      ) : (
        !error && (
          <div
            style={{
              padding: '12px',
              background: 'var(--bg-code, #f5f5f5)',
              borderRadius: 'var(--radius-card)',
              border: '1px solid var(--border-card)',
              color: 'var(--text-secondary)',
              fontFamily: 'monospace',
              fontSize: '12px',
              minHeight: '80px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            Fill in the form to preview YAML
          </div>
        )
      )}
    </Space>
  );
}
