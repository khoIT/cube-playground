/**
 * ReasoningTrace — collapsible disclosure for assistant thinking/reasoning text.
 * Defaults collapsed; muted color to de-emphasise vs main response.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';

interface ReasoningTraceProps {
  text: string;
}

export function ReasoningTrace({ text }: ReasoningTraceProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        borderLeft: `2px solid ${T.n200}`,
        marginLeft: 2,
        marginTop: 4,
        marginBottom: 4,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 10px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: T.n400,
          fontFamily: T.fSans,
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
        aria-expanded={open}
      >
        <Icon icon={Brain} size={12} color={T.n400} />
        <span>Reasoning</span>
        <Icon icon={open ? ChevronDown : ChevronRight} size={12} color={T.n400} />
      </button>

      {open && (
        <div
          style={{
            padding: '6px 10px 8px',
            color: T.n500,
            fontFamily: T.fMono,
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
