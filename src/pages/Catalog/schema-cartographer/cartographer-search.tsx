/**
 * Debounced search input for the schema cartographer.
 * 150ms debounce hits the latency target from phase-02 non-functional reqs.
 */
import React, { useEffect, useState } from 'react';

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

const DEBOUNCE_MS = 150;

export function CartographerSearch({ value, onChange, placeholder = 'Search measures, dimensions, segments…' }: Props) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (local !== value) onChange(local);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [local, value, onChange]);

  return (
    <input
      type="search"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      placeholder={placeholder}
      aria-label="Search schema"
      style={{
        width: '100%',
        padding: '8px 12px',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--bg-card)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        outline: 'none',
      }}
    />
  );
}
