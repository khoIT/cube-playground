/** Segment editor — orchestrates identity / predicate / refresh / preview. */

import { ReactElement, useEffect, useState } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { Button, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import { Breadcrumbs } from '../visuals';
import { IdentityCard } from './identity-card';
import { RefreshBehaviourCard } from './refresh-behaviour-card';
import { renderRoot } from './predicate-builder/predicate-group';
import { usePredicateState, isTreeValid } from './hooks/use-predicate-state';
import { usePreview } from './hooks/use-preview';
import { ResolvedCohortCard } from './right-rail/resolved-cohort-card';
import { SqlPreviewCard } from './right-rail/sql-preview-card';
import type { Segment, SegmentType, GroupNode, PredicateNode } from '../../../types/segment-api';
import styles from '../segments.module.css';

interface EditorParams { id?: string }

export function EditorView(): ReactElement {
  const { t } = useTranslation();
  const history = useHistory();
  const { id } = useParams<EditorParams>();

  const [name, setName] = useState('');
  const [cube, setCube] = useState<string | null>(null);
  const [type, setType] = useState<SegmentType>('predicate');
  const [cadence, setCadence] = useState<number | null>(60);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!id);

  const predicate = usePredicateState();

  useEffect(() => {
    if (!id) return;
    segmentsClient
      .get(id)
      .then((seg: Segment) => {
        setName(seg.name);
        setCube(seg.cube);
        setType(seg.type);
        setCadence(seg.refresh_cadence_min ?? 60);
        if (seg.predicate_tree) predicate.replaceTree(seg.predicate_tree);
        setLoaded(true);
      })
      .catch((err: SegmentApiError) => {
        message.error(err.message);
        setLoaded(true);
      });
  }, [id]);

  const valid = isTreeValid(predicate.tree) && name.trim().length > 0 && cube != null;

  const preview = usePreview({
    tree: predicate.tree,
    primaryCube: cube,
    enabled: cube != null && isTreeValid(predicate.tree),
  });

  const handleSave = async () => {
    if (!valid) {
      message.error('Fix the predicate and name first.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        cube,
        type,
        predicate_tree: type === 'predicate' ? (predicate.tree as PredicateNode) : null,
        refresh_cadence_min: type === 'predicate' ? cadence : null,
      };
      if (id) {
        await segmentsClient.update(id, payload);
        message.success('Segment updated.');
        history.push(`/segments/${id}`);
      } else {
        const created = await segmentsClient.create(payload);
        message.success('Segment created.');
        history.push(`/segments/${created.id}`);
      }
    } catch (err) {
      message.error(err instanceof SegmentApiError ? err.message : (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <main className={styles.page}>
        <div className={styles.skeletonRow} style={{ width: 240, height: 28 }} />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <Breadcrumbs items={[
        { label: 'Segments', href: '#/segments' },
        { label: id ? `Edit ${name || 'segment'}` : 'New segment' },
      ]} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <IdentityCard name={name} cube={cube} onNameChange={setName} onCubeChange={setCube} />
          <RefreshBehaviourCard
            type={type}
            cadenceMin={cadence}
            onTypeChange={setType}
            onCadenceChange={setCadence}
          />
          {renderRoot(predicate.tree, {
            toggleConj: predicate.toggleConj,
            addLeaf: predicate.addLeaf,
            addGroup: predicate.addGroup,
            removeNode: predicate.removeNode,
            setLeafMember: predicate.setLeafMember,
            setLeafOp: predicate.setLeafOp,
            setLeafValues: predicate.setLeafValues,
          })}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={() => history.goBack()}>Cancel</Button>
            <Button type="primary" loading={saving} disabled={!valid} onClick={handleSave}>
              {id ? 'Save changes' : 'Create segment'}
            </Button>
          </div>
        </div>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 16 }}>
          <ResolvedCohortCard
            count={preview.count}
            loading={preview.loading}
            error={preview.error}
            ringBuffer={preview.ringBuffer}
          />
          <SqlPreviewCard sql={preview.sql} loading={preview.loading} />
        </aside>
      </div>
    </main>
  );
}
