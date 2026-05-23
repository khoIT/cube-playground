/**
 * UserMessage — right-aligned bubble for user turns.
 */
import React from 'react';
import { T } from '../../../shell/theme';

interface UserMessageProps {
  text: string;
  ts?: string;
}

export function UserMessage({ text, ts }: UserMessageProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        padding: '4px 16px',
      }}
    >
      <div
        style={{
          maxWidth: '72%',
          background: T.brand,
          color: '#fff',
          borderRadius: '16px 16px 4px 16px',
          padding: '10px 14px',
          fontFamily: T.fSans,
          fontSize: 14,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
        {ts && (
          <div
            style={{
              marginTop: 4,
              fontSize: 11,
              color: 'rgba(255,255,255,0.65)',
              textAlign: 'right',
            }}
          >
            {ts}
          </div>
        )}
      </div>
    </div>
  );
}
