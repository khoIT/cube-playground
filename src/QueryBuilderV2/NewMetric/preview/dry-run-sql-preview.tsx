import { PrismCode, Space, Text } from '@cube-dev/ui-kit';

type DryRunResult = {
  sql: string | null;
  error: string | null;
};

interface DryRunSqlPreviewProps {
  isRunning: boolean;
  result: DryRunResult | null;
}

const PLACEHOLDER_STYLE: React.CSSProperties = {
  padding: '12px',
  background: 'var(--bg-code)',
  borderRadius: 'var(--radius-card)',
  border: '1px solid var(--border-card)',
  color: 'var(--text-secondary)',
  fontFamily: 'monospace',
  fontSize: '12px',
  minHeight: '80px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const ERROR_STYLE: React.CSSProperties = {
  ...PLACEHOLDER_STYLE,
  color: 'var(--danger)',
  background: 'var(--destructive-soft)',
  border: '1px solid var(--destructive-ink)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  justifyContent: 'flex-start',
  alignItems: 'flex-start',
};

/**
 * Renders the compiled SQL from a Cube /sql dry-run, or an error/placeholder.
 * Receives pre-computed result from useDryRunSql — no fetching here.
 */
export function DryRunSqlPreview({ isRunning, result }: DryRunSqlPreviewProps) {
  return (
    <Space direction="vertical" gap="1x">
      <Text preset="t3m" style={{ color: 'var(--text-secondary)' }}>
        Source SQL preview
      </Text>

      {isRunning && (
        <div style={PLACEHOLDER_STYLE}>Running…</div>
      )}

      {!isRunning && !result && (
        <div style={PLACEHOLDER_STYLE}>
          Click &ldquo;Validate&rdquo; to preview compiled SQL
        </div>
      )}

      {!isRunning && result?.error && (
        <div style={ERROR_STYLE}>{result.error}</div>
      )}

      {!isRunning && result?.sql && (
        <PrismCode code={result.sql} language="sql" />
      )}
    </Space>
  );
}
