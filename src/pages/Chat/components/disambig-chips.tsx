/**
 * DisambigChips — clickable pill row rendered below an assistant turn whose
 * disambiguate_query tool returned a clarification. Mirrors FollowupChips
 * styling so the chat surface stays visually consistent.
 *
 * Each chip's pinText, when sent as the next user message, lets the BE
 * disambiguator (with session memory) resolve the slot without re-asking.
 * The same click also writes the resolution into kv_cache server-side, so
 * subsequent turns auto-route the same slot.
 */
import React from 'react';
import { T } from '../../../shell/theme';
import { postChatAudit } from '../../../api/chat-audit-client';
import type { DisambigOption } from '../../../api/chat-sse-client';

interface Props {
  prompt: string;
  slot: 'metric' | 'dimension' | 'timeRange';
  options: ReadonlyArray<DisambigOption>;
  onPick: (pinText: string) => void;
}

export function DisambigChips({ prompt, slot, options, onPick }: Props) {
  if (options.length === 0) return null;

  return (
    <div
      data-testid="disambig-chips"
      data-slot={slot}
      style={{ marginTop: 10 }}
    >
      <div
        style={{
          fontSize: 11,
          color: T.n500,
          marginBottom: 6,
          fontFamily: T.fSans,
        }}
      >
        {prompt}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map((opt) => (
          <button
            key={opt.label}
            type="button"
            data-chip-label={opt.label}
            onClick={() => {
              postChatAudit({
                kind: 'disambig_chip_picked',
                detail: { slot, label: opt.label },
              });
              onPick(opt.pinText);
            }}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: `1px solid ${T.n300}`,
              background: T.surface,
              color: T.n800,
              cursor: 'pointer',
              fontFamily: T.fSans,
              fontSize: 12.5,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
