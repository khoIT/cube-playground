/**
 * Create-new-dashboard sub-form used inside PinToDashboardModal.
 * Owns the title + slug inputs with auto-derive logic.
 */

import React, { useEffect, useState } from 'react';

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface CreateFormValues {
  title: string;
  slug: string;
}

interface PinModalCreateFormProps {
  onChange: (values: CreateFormValues) => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-card, #d1d5db)',
  fontSize: 13,
  boxSizing: 'border-box',
  outline: 'none',
};

export function PinModalCreateForm({ onChange }: PinModalCreateFormProps) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);

  useEffect(() => {
    if (!slugManual) setSlug(toSlug(title));
  }, [title, slugManual]);

  useEffect(() => {
    onChange({ title, slug });
  }, [title, slug, onChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
          Dashboard title
        </label>
        <input
          autoFocus
          style={inputStyle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="My Dashboard"
        />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
          Slug
        </label>
        <input
          style={inputStyle}
          value={slug}
          onChange={(e) => { setSlug(e.target.value); setSlugManual(true); }}
          placeholder="my-dashboard"
        />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
          URL-safe identifier, e.g. /dashboards/{slug || 'my-dashboard'}
        </span>
      </div>
    </div>
  );
}
