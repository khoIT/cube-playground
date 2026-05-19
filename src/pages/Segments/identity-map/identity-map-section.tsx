/**
 * Identity-map settings page — list every cube and let the user pick the
 * identity dim. Auto-suggested entries can be saved (PUT) or left as-is;
 * manual overrides can be reset.
 */

import { ReactElement, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { message } from 'antd';
import { apiFetch } from '../../../api/api-client';
import { identityMapClient } from '../../../api/segments-client';
import { invalidateIdentityMap } from '../../../hooks/use-identity-map';
import type { CubeIdentityMapping } from '../../../types/segment-api';
import { IdentityMapRow } from './identity-map-row';
import styles from '../segments.module.css';

interface MergedRow extends CubeIdentityMapping {
  is_suggested?: boolean;
  matched_pattern?: string | null;
}

export function IdentityMapSection(): ReactElement {
  const [rows, setRows] = useState<MergedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCube, setPendingCube] = useState<string | null>(null);

  const load = () => {
    apiFetch<MergedRow[]>('/api/identity-map')
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async (cube: string, field: string) => {
    setPendingCube(cube);
    try {
      await identityMapClient.put(cube, field, 1);
      invalidateIdentityMap();
      message.success(`Saved identity field for ${cube}.`);
      load();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setPendingCube(null);
    }
  };

  const handleReset = async (cube: string) => {
    setPendingCube(cube);
    try {
      await apiFetch<void>(`/api/identity-map/${encodeURIComponent(cube)}`, { method: 'DELETE' });
      invalidateIdentityMap();
      message.success(`Reverted ${cube} to auto-suggest.`);
      load();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setPendingCube(null);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1>Identity mapping</h1>
          <p>
            Tell us which dimension is the user-id for each cube. Auto-suggested
            values are guessed from dimension naming. <Link to="/segments">Back to segments</Link>.
          </p>
        </div>
      </header>

      {error && <div className={styles.errorState}>{error}</div>}
      {!error && rows == null && (
        <div className={styles.tableCard} style={{ padding: 16 }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} className={styles.skeletonRow} />
          ))}
        </div>
      )}
      {!error && rows != null && rows.length === 0 && (
        <div className={styles.emptyState}>No cubes found in /meta.</div>
      )}
      {!error && rows != null && rows.length > 0 && (
        <div className={styles.tableCard}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1.5fr 180px 120px',
              gap: 12,
              padding: '10px 16px',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--text-tertiary, var(--text-secondary))',
              borderBottom: '1px solid var(--border-card)',
            }}
          >
            <span>Cube</span>
            <span>Identity dimension</span>
            <span>Source</span>
            <span />
          </div>
          {rows.map((row) => (
            <IdentityMapRow
              key={row.cube}
              row={row}
              onSave={handleSave}
              onReset={handleReset}
              pending={pendingCube === row.cube}
            />
          ))}
        </div>
      )}
    </main>
  );
}
