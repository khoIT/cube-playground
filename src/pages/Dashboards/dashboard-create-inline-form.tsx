/**
 * Inline create-dashboard form for the list page.
 * Owns title + slug state, calls onSubmit / onCancel.
 */

import React, { useState } from 'react';

function toSlug(title: string): string {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

interface DashboardCreateInlineFormProps {
  submitting: boolean;
  error: string | null;
  onSubmit: (title: string, slug: string) => void;
  onCancel: () => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', borderRadius: 6,
  border: '1px solid var(--border-card, #d1d5db)', fontSize: 13, boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'var(--brand, #6366f1)', color: '#fff', border: 'none',
  borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

export function DashboardCreateInlineForm({
  submitting, error, onSubmit, onCancel,
}: DashboardCreateInlineFormProps) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);

  function handleTitleChange(t: string) {
    setTitle(t);
    if (!slugManual) setSlug(toSlug(t));
  }

  return (
    <div style={{ background: 'var(--bg-card,#fff)', border: '1px solid var(--border-card,#e5e7eb)', borderRadius: 10, padding: '16px 20px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontWeight: 600, fontSize: 14 }}>New dashboard</span>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Title</label>
        <input autoFocus style={inputStyle} value={title} onChange={(e) => handleTitleChange(e.target.value)} placeholder="My Dashboard" />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Slug</label>
        <input style={inputStyle} value={slug} onChange={(e) => { setSlug(e.target.value); setSlugManual(true); }} placeholder="my-dashboard" />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 2 }}>/dashboards/{slug || 'my-dashboard'}</span>
      </div>
      {error && (
        <div style={{ fontSize: 12, color: 'var(--danger,#dc2626)', background: 'var(--bg-danger,#fef2f2)', borderRadius: 6, padding: '5px 10px' }}>{error}</div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ background: 'transparent', border: '1px solid var(--border-card,#d1d5db)', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}>
          Cancel
        </button>
        <button style={{ ...btnPrimary, opacity: submitting ? 0.6 : 1 }} disabled={submitting}
          onClick={() => onSubmit(title, slug)}>
          {submitting ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  );
}
