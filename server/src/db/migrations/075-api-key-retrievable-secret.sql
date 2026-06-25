-- Make the public API key recoverable on demand (not show-once).
--
-- Product decision: this is a single-trusted-admin, VPN-only playground, and
-- operators need to re-copy a key whenever they want (and extend an expired
-- one without re-minting). So we persist the secret in a RECOVERABLE form:
--   - key_secret holds the secret material,
--   - key_secret_sealed = 1 when it's AES-256-GCM sealed (CONNECTOR_SECRET_KEY
--     configured) — the preferred at-rest form; 0 when stored raw (no vault key,
--     e.g. local dev).
-- The sha256 column stays the verify-path lookup. Keys minted before this
-- migration have NULL key_secret → not recoverable (re-mint to get a copy).
--
-- Tradeoff (accepted): a recoverable secret is, by definition, exposed to anyone
-- with admin access (+ the vault key, when sealed). That matches how this app
-- already hands admins warehouse credentials via the pull-credentials endpoint.

ALTER TABLE api_keys ADD COLUMN key_secret TEXT;
ALTER TABLE api_keys ADD COLUMN key_secret_sealed INTEGER NOT NULL DEFAULT 0;
