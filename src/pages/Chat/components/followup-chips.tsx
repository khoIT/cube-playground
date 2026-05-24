/**
 * FollowupChips — pill row rendered below a settled assistant turn. Click
 * a chip → prefill composer with chip text and submit immediately (phase-04
 * requirement). Submit is a separate prop because the composer & send
 * hooks live one level up (chat-thread-page).
 */
import React from 'react';
import { T } from '../../../shell/theme';
import { postChatAudit } from '../../../api/chat-audit-client';
import type { FollowupChip } from '../services/followup-suggester';

interface Props {
  chips: ReadonlyArray<FollowupChip>;
  onPick: (chip: FollowupChip) => void;
}

export function FollowupChips({ chips, onPick }: Props) {
  if (chips.length === 0) return null;
  return (
    <div
      data-testid="followup-chips"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 10,
      }}
    >
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          data-chip-id={chip.id}
          onClick={() => {
            postChatAudit({
              kind: 'followup_clicked',
              detail: { chipId: chip.id, derivedFrom: chip.derivedFrom },
            });
            onPick(chip);
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
          {chip.text}
        </button>
      ))}
    </div>
  );
}
