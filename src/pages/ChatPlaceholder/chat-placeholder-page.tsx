/**
 * ChatPlaceholderPage — empty-state for `/chat`. Conversational analytics
 * is not yet wired; this page acknowledges the entry exists and routes the
 * user toward the active product surfaces.
 */
import React from 'react';
import { MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { T } from '../../shell/theme';

export function ChatPlaceholderPage() {
  return (
    <div style={{ padding: 32 }}>
      <div style={{
        maxWidth: 480, margin: '80px auto',
        background: T.surface, border: `1px solid ${T.n200}`, borderRadius: 12,
        padding: 48, textAlign: 'center',
      }}>
        <MessageSquare size={48} color={T.n400} style={{ margin: '0 auto 16px' }} />
        <h1 style={{
          fontFamily: T.fDisp, fontSize: 32, fontWeight: 400, color: T.n950,
          letterSpacing: '0.005em', textTransform: 'uppercase', margin: 0,
        }}>Chat coming soon</h1>
        <p style={{
          fontFamily: T.fSans, fontSize: 13, color: T.n500, margin: '8px 0 24px',
        }}>
          Conversational analytics will appear here.
        </p>
        <Link to="/build" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '0 14px', height: 34, borderRadius: 8,
          background: T.brand, color: '#fff', textDecoration: 'none',
          fontFamily: T.fSans, fontWeight: 500, fontSize: 13,
        }}>Go to Playground</Link>
      </div>
    </div>
  );
}
