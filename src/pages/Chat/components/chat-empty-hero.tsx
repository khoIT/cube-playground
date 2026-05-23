/**
 * ChatEmptyHero — state-of-the-art landing for /chat (no session yet).
 *
 * Composition: cube logo + wordmark + subtitle + custom composer with
 * Deep Research pill toggle + circular send + suggested-question list.
 *
 * Suggestion clicks prefill the composer (no auto-submit) — Q10 plan
 * decision. Deep Research is a mocked FE-only flag for now; the value is
 * passed through but the chat-service treats it as a no-op.
 */
import React, { useState } from 'react';
import { ArrowUp, CornerDownRight } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';
import { useTheme } from '../../../theme/use-theme';
import cubeLogoLight from '../../../assets/brand/cube-logo-light.png';
import cubeLogoDark from '../../../assets/brand/cube-logo-dark.png';

const SUGGESTIONS: ReadonlyArray<string> = [
  'Show daily revenue last 7 days',
  'Compare ARPDAU month-over-month',
  'Top 10 campaigns by ROAS',
  'Find at-risk whales who haven’t logged in this week',
  'Compare retention curves across cohorts',
] as const;

interface ChatEmptyHeroProps {
  composerValue: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}

export function ChatEmptyHero({ composerValue, onChange, onSubmit, disabled }: ChatEmptyHeroProps) {
  const [deepResearch, setDeepResearch] = useState(false);

  function handleSuggestion(text: string) {
    onChange(text);
  }

  return (
    <div
      style={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '48px 24px 48px',
        overflowY: 'auto',
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

        <HomeComposer
          value={composerValue}
          onChange={onChange}
          onSubmit={onSubmit}
          disabled={disabled}
          deepResearch={deepResearch}
          onToggleDeepResearch={() => setDeepResearch((v) => !v)}
        />

        <SuggestionsList onPick={handleSuggestion} />
      </div>
    </div>
  );
}

function CubeLogoBlock() {
  const { theme } = useTheme();
  // Self-contained brand PNGs — each includes its own square background.
  // cube-logo-dark.png is the black-bg variant (the "dark island" the design
  // calls for on light pages). cube-logo-light.png is the white-bg variant
  // used on dark pages. Switch on the inverse of the page theme.
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

interface HomeComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  deepResearch: boolean;
  onToggleDeepResearch: () => void;
}

function HomeComposer({
  value, onChange, onSubmit, disabled, deepResearch, onToggleDeepResearch,
}: HomeComposerProps) {
  const canSubmit = value.trim().length > 0 && !disabled;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const isSubmit = (e.metaKey || e.ctrlKey) && e.key === 'Enter';
    const isEnter = e.key === 'Enter' && !e.shiftKey;
    if (isSubmit || isEnter) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
  }

  return (
    <div
      style={{
        width: '100%',
        border: `1px solid ${T.n300}`,
        borderRadius: 14,
        background: T.surface,
        padding: '18px 18px 14px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="What do you want to know?"
        rows={1}
        style={{
          border: 'none', outline: 'none', resize: 'none',
          background: 'transparent',
          fontFamily: T.fSans, fontSize: 15, color: T.n900,
          lineHeight: 1.5, padding: 0,
          minHeight: 24, maxHeight: 200,
        }}
        aria-label="Ask Cube"
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <DeepResearchToggle active={deepResearch} onToggle={onToggleDeepResearch} />
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => { if (canSubmit) onSubmit(); }}
          disabled={!canSubmit}
          aria-label="Send"
          style={{
            width: 32, height: 32, borderRadius: 16, border: 'none',
            background: canSubmit ? T.n900 : T.n300,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: canSubmit ? 'pointer' : 'default',
            transition: 'background 0.15s',
          }}
        >
          <Icon icon={ArrowUp} size={16} color="#fff" />
        </button>
      </div>
    </div>
  );
}

function DeepResearchToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  // macOS-style switch + label. ON: dark track with knob on the right.
  // OFF: cream/n200 track with knob on the left. No brand-colour highlight
  // on either state — the switch position carries all the signal.
  const TRACK_W = 38;
  const TRACK_H = 22;
  const KNOB = 18;
  const trackBg = active ? T.n900 : T.n200;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={active ? 'Disable Deep Research' : 'Enable Deep Research'}
      title={active ? 'Deep Research: On' : 'Deep Research: Off'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10,
        border: 'none', background: 'transparent', padding: 0,
        cursor: 'pointer',
        color: T.n800, fontFamily: T.fSans, fontSize: 14,
      }}
    >
      <span
        aria-hidden
        style={{
          width: TRACK_W, height: TRACK_H, borderRadius: TRACK_H / 2,
          background: trackBg,
          position: 'relative', display: 'inline-block', flexShrink: 0,
          transition: 'background 0.18s',
        }}
      >
        <span
          style={{
            position: 'absolute', top: (TRACK_H - KNOB) / 2,
            left: active ? TRACK_W - KNOB - 2 : 2,
            width: KNOB, height: KNOB, borderRadius: KNOB / 2,
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
            transition: 'left 0.18s',
          }}
        />
      </span>
      Deep Research
    </button>
  );
}

function SuggestionsList({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div style={{ width: '100%', marginTop: 24, display: 'flex', flexDirection: 'column' }}>
      {SUGGESTIONS.map((text, idx) => (
        <button
          key={text}
          type="button"
          onClick={() => onPick(text)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 4px', border: 'none', background: 'transparent',
            cursor: 'pointer', textAlign: 'left',
            borderTop: idx === 0 ? 'none' : `1px solid ${T.n200}`,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = T.surfaceSubtle; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          <Icon icon={CornerDownRight} size={14} color={T.n400} />
          <span style={{
            flex: 1, fontFamily: T.fSans, fontSize: 14, color: T.n800,
          }}>{text}</span>
        </button>
      ))}
    </div>
  );
}
