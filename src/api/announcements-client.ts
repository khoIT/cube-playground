/**
 * Client for the What's New read-state API (server: routes/announcements.ts).
 *   GET  /api/announcements/reads  → { readIds }
 *   POST /api/announcements/reads  → mark ids read, returns the new { readIds }
 *
 * Defensive: a transient failure returns the empty/unchanged list rather than
 * throwing, so the inbox still renders content (the badge just won't update).
 */

import { apiFetch } from './api-client';

interface ReadsResponse {
  readIds: string[];
}

export async function listReadAnnouncementIds(): Promise<string[]> {
  try {
    const res = await apiFetch<ReadsResponse>('/api/announcements/reads');
    return res.readIds ?? [];
  } catch {
    return [];
  }
}

/** Mark ids read; returns the server's full read set (or [] on failure). */
export async function markAnnouncementsRead(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  try {
    const res = await apiFetch<ReadsResponse>('/api/announcements/reads', {
      method: 'POST',
      body: { ids },
    });
    return res.readIds ?? [];
  } catch {
    return [];
  }
}
