/**
 * Pre-provision-by-email form. POSTs a new user (defaults status active).
 * Surfaces the server error message; never fakes success.
 */

import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { createAdminUser } from './use-admin-access';

interface PreProvisionFormProps {
  onCreated: (email: string) => void;
}

export function PreProvisionForm({ onCreated }: PreProvisionFormProps) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) { setError('Email is required.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await createAdminUser({ email: value });
      setEmail('');
      onCreated(value);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-card)', padding: '14px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <UserPlus size={16} style={{ color: 'var(--brand)' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          Pre-provision by email
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="person@company.com"
          style={{
            flex: 1, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--font-sans)',
            color: 'var(--text-primary)', background: 'var(--bg-app)',
            border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={submitting}
          style={{
            background: 'var(--brand)', color: '#fff', border: 'none',
            borderRadius: 'var(--radius-sm)', padding: '7px 16px',
            fontSize: 13, fontWeight: 600, cursor: submitting ? 'default' : 'pointer',
            opacity: submitting ? 0.6 : 1, fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
          }}
        >
          {submitting ? 'Adding…' : 'Add user'}
        </button>
      </div>
      {error && (
        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 500, color: 'var(--destructive-ink)' }}>
          {error}
        </div>
      )}
    </form>
  );
}
