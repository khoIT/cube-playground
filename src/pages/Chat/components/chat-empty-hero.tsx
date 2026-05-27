/**
 * ChatEmptyHero — state-of-the-art landing for /chat (no session yet).
 *
 * Composition: cube logo + wordmark + subtitle + custom composer with
 * Research mode toggle + circular send + starter library grid.
 *
 * Starter clicks prefill the composer (no auto-submit) per decision Q10.
 * Cold-start (intent observations < STARTER_RANK_MIN_SESSIONS) renders all
 * 16 starters in source order; afterward persona-histogram ranks them.
 * Research mode toggle is wired end-to-end: ON sends X-Research-Mode: 1
 * which enables both web search and research mode for that turn (subject to
 * CHAT_ENABLE_WEB_SEARCH + CHAT_ENABLE_RESEARCH_MODE env master flags).
 */
import React, { useCallback, useState } from 'react';
import { T } from '../../../shell/theme';
import { useTheme } from '../../../theme/use-theme';
import cubeLogoLight from '../../../assets/brand/cube-logo-light.png';
import cubeLogoDark from '../../../assets/brand/cube-logo-dark.png';
import { ChatComposer } from './chat-composer';
import { StarterLibraryGrid } from './starter-library-grid';
import {
  StarterPersonaFilter,
  type StarterPersonaFilterValue,
} from './starter-persona-filter';
import {
  STARTER_RANK_MIN_SESSIONS,
  type StarterQuestion,
} from '../library/starter-questions';
import { useStarterRanking } from '../library/use-starter-ranking';
import { postChatAudit } from '../../../api/chat-audit-client';

interface ChatEmptyHeroProps {
  composerValue: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  /** Bypass cache toggle — when ON, sends X-Bypass-Cache: 1 on the next turn. */
  bypassCache: boolean;
  onToggleBypassCache: () => void;
  /** Web search toggle — when ON, sends X-Web-Search: 1 per turn. */
  webSearch: boolean;
  onToggleWebSearch: () => void;
  /** Research mode toggle — when ON, sends X-Research-Mode: 1 per turn. */
  researchMode: boolean;
  onToggleResearchMode: () => void;
}

export function ChatEmptyHero({ composerValue, onChange, onSubmit, disabled, bypassCache, onToggleBypassCache, webSearch, onToggleWebSearch, researchMode, onToggleResearchMode }: ChatEmptyHeroProps) {
  const [personaFilter, setPersonaFilter] = useState<StarterPersonaFilterValue>('all');

  const filter = useCallback(
    (s: StarterQuestion) => {
      if (personaFilter === 'all') return true;
      return s.personaTags.includes(personaFilter);
    },
    [personaFilter],
  );
  const { ranked } = useStarterRanking(STARTER_RANK_MIN_SESSIONS, filter);

  const handlePick = useCallback(
    (starter: StarterQuestion) => {
      onChange(starter.text);
      postChatAudit({
        kind: 'starter_clicked',
        detail: { starterId: starter.id, persona: personaFilter },
      });
    },
    [onChange, personaFilter],
  );

  return (
    <div
      style={{
        minWidth: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '48px 24px 48px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <CubeLogoBlock />
        <p
          style={{
            fontFamily: T.fSans, fontSize: 15, color: T.n500,
            margin: '20px 0 36px', textAlign: 'center', maxWidth: 560,
            lineHeight: 1.5,
          }}
        >
          Ask anything about your players, retention, segments, or campaigns.
        </p>

        <ChatComposer
          value={composerValue}
          onChange={onChange}
          onSubmit={onSubmit}
          disabled={disabled}
          bypassCache={bypassCache}
          onToggleBypassCache={onToggleBypassCache}
          webSearch={webSearch}
          onToggleWebSearch={onToggleWebSearch}
          deepResearch={researchMode}
          onToggleDeepResearch={onToggleResearchMode}
        />

        <div style={{ width: '100%', marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <StarterPersonaFilter value={personaFilter} onChange={setPersonaFilter} />
          <StarterLibraryGrid starters={ranked} onPick={handlePick} />
        </div>
      </div>
    </div>
  );
}

function CubeLogoBlock() {
  const { theme } = useTheme();
  const logoSrc = theme === 'dark' ? cubeLogoLight : cubeLogoDark;
  return (
    <>
      <img
        src={logoSrc}
        alt="Cube"
        style={{
          width: 96, height: 96, display: 'block',
          borderRadius: 18,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        }}
      />
      <h1
        style={{
          fontFamily: T.fDisp, fontSize: 48, fontWeight: 400,
          letterSpacing: '0.03em', textTransform: 'uppercase',
          color: T.n950, margin: '20px 0 0', textAlign: 'center', lineHeight: 1,
        }}
      >
        Cube
      </h1>
    </>
  );
}

