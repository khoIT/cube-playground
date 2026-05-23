/**
 * TypingDots — animated "..." indicator shown while assistant is composing.
 * Three dots blink in staggered sequence via CSS animation.
 */
import React from 'react';
import { T } from '../../../shell/theme';

const keyframes = `
@keyframes chat-blink {
  0%, 80%, 100% { opacity: 0.2; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}
`;

let styleInjected = false;
function injectStyle() {
  if (styleInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = keyframes;
  document.head.appendChild(style);
  styleInjected = true;
}

export function TypingDots() {
  injectStyle();
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '8px 12px',
      }}
      aria-label="Assistant is typing"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: T.n400,
            animation: `chat-blink 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
