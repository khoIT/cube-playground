/**
 * Audit base-path context — lets the chat-audit shell + its children build
 * route/link paths relative to wherever the shell is mounted.
 *
 * The same DevAuditShell renders at two roots:
 *   - /dev/chat-audit            (standalone, self-scoped)
 *   - /admin/dev/chat-audit      (sys-admin hub, cross-user scope=all)
 *
 * Instead of hardcoding "/dev/chat-audit" in every <Route>, <Redirect>,
 * history.push, and <a href>, components read the active base from context and
 * compose sub-paths with auditPath(). The default value keeps the standalone
 * mount working even if a component is rendered outside a provider.
 */

import React, { createContext, useContext } from 'react';

/** The standalone mount path — also the safe default outside any provider. */
export const DEFAULT_AUDIT_BASE_PATH = '/dev/chat-audit';

const AuditBasePathContext = createContext<string>(DEFAULT_AUDIT_BASE_PATH);

export const AuditBasePathProvider = AuditBasePathContext.Provider;

/** Read the base path of the currently-mounted chat-audit shell. */
export function useAuditBasePath(): string {
  return useContext(AuditBasePathContext);
}

/**
 * Join sub-segments onto a base path, dropping empty segments.
 * auditPath('/dev/chat-audit', 'sessions', id) → '/dev/chat-audit/sessions/<id>'
 * Hash/query suffixes are appended by the caller (auditPath only joins '/').
 */
export function auditPath(base: string, ...segments: Array<string | null | undefined>): string {
  return [base, ...segments.filter((s): s is string => Boolean(s))].join('/');
}
