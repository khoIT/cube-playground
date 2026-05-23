/**
 * QueryArtifactCard — displays a Cube query artifact emitted by the agent.
 *
 * On "Open in Playground" click:
 *   - if deeplinkVia === 'session-storage': write payload to sessionStorage first
 *   - then history.push(deeplinkUrl)
 *   - then call onClick?.()
 */
import React from 'react';
import { useHistory } from 'react-router-dom';
import { BarChart2, ExternalLink } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';
import type { QueryArtifact } from '../../../api/chat-sse-client';

interface QueryArtifactCardProps {
  artifact: QueryArtifact;
  onClick?: () => void;
}

const SOURCE_LABEL: Record<QueryArtifact['source'], string> = {
  'business-metric': 'Metric',
  segment: 'Segment',
  raw: 'Raw Query',
};

const SOURCE_COLOR: Record<QueryArtifact['source'], string> = {
  'business-metric': T.brand,
  segment: T.blue500,
  raw: T.purple500,
};

export function QueryArtifactCard({ artifact, onClick }: QueryArtifactCardProps) {
  const history = useHistory();

  function handleOpen() {
    // Write payload to sessionStorage BEFORE navigation for session-storage artifacts.
    if (artifact.deeplinkVia === 'session-storage') {
      try {
        sessionStorage.setItem(
          `gds-cube:pending-chat-deeplink:${artifact.id}`,
          JSON.stringify(artifact.payload),
        );
      } catch {
        // sessionStorage quota/unavailable — proceed anyway; /build will show stale toast.
      }
    }
    // Push deeplinkUrl (hash-based) into React Router history.
    // deeplinkUrl is "#/build?..." — strip the leading '#' for react-router-dom v5.
    const path = artifact.deeplinkUrl.startsWith('#')
      ? artifact.deeplinkUrl.slice(1)
      : artifact.deeplinkUrl;
    history.push(path);
    onClick?.();
  }

  const sourceColor = SOURCE_COLOR[artifact.source] ?? T.n400;
  const sourceLabel = SOURCE_LABEL[artifact.source] ?? artifact.source;

  return (
    <div
      style={{
        border: `1px solid ${T.n200}`,
        borderRadius: 10,
        background: T.surface,
        overflow: 'hidden',
        maxWidth: 440,
        margin: '6px 0',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px 8px',
          borderBottom: `1px solid ${T.n100}`,
        }}
      >
        <Icon icon={BarChart2} size={16} color={T.brand} />
        <span
          style={{
            flex: 1,
            fontFamily: T.fSans,
            fontSize: 14,
            fontWeight: 600,
            color: T.n900,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {artifact.title}
        </span>
        {/* Source badge */}
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 12,
            background: `${sourceColor}18`,
            border: `1px solid ${sourceColor}40`,
            fontFamily: T.fSans,
            fontSize: 11,
            fontWeight: 500,
            color: sourceColor,
            flexShrink: 0,
          }}
        >
          {sourceLabel}
        </span>
      </div>

      {/* Summary */}
      {artifact.summary && (
        <div
          style={{
            padding: '8px 14px',
            fontFamily: T.fSans,
            fontSize: 13,
            color: T.n600,
            lineHeight: 1.5,
          }}
        >
          {artifact.summary}
        </div>
      )}

      {/* Footer action */}
      <div
        style={{
          padding: '8px 14px 10px',
          display: 'flex',
          justifyContent: 'flex-end',
          borderTop: artifact.summary ? `1px solid ${T.n100}` : undefined,
        }}
      >
        <button
          type="button"
          onClick={handleOpen}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 12px',
            borderRadius: 6,
            background: T.brand,
            border: 'none',
            cursor: 'pointer',
            fontFamily: T.fSans,
            fontSize: 12,
            fontWeight: 500,
            color: '#fff',
          }}
        >
          <Icon icon={ExternalLink} size={13} color="#fff" />
          Open in Playground
        </button>
      </div>
    </div>
  );
}
