/** Pre-formatted SQL preview with copy button. */

import { ReactElement } from 'react';
import { Button, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';

interface Props {
  sql: string | null;
  loading: boolean;
}

export function SqlPreviewCard({ sql, loading }: Props): ReactElement {
  const onCopy = async () => {
    if (!sql) return;
    try {
      await navigator.clipboard.writeText(sql);
      message.success('SQL copied.');
    } catch (e) {
      message.error('Copy failed.');
    }
  };

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxHeight: 320,
        overflow: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Generated SQL</span>
        <span style={{ flex: 1 }} />
        <Button size="small" icon={<CopyOutlined />} onClick={onCopy} disabled={!sql}>
          Copy
        </Button>
      </div>
      <pre
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11.5,
          margin: 0,
          whiteSpace: 'pre-wrap',
          color: 'var(--text-secondary)',
        }}
      >
        {loading ? '…' : sql ?? 'Live SQL preview will render here once the predicate is valid.'}
      </pre>
    </div>
  );
}
