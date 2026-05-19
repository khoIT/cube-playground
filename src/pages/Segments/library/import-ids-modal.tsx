/** Import-IDs modal — upload a CSV of uids and create a static segment. */

import { ReactElement, useEffect, useState } from 'react';
import { Modal, Input, Select, Button, Upload, message, Alert } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { apiFetch } from '../../../api/api-client';
import { useIdentityMap } from '../../../hooks/use-identity-map';
import styles from '../segments.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (segmentId: string) => void;
}

interface ImportResponse {
  id: string;
  uid_count: number;
  truncated: boolean;
  max_rows: number;
  errors: { line: number; reason: string }[];
}

export function ImportIdsModal({ open, onClose, onCreated }: Props): ReactElement {
  const { mappings, hasIdentityFor } = useIdentityMap();
  const cubes = mappings.filter((m) => hasIdentityFor(m.cube));

  const [name, setName] = useState('');
  const [cube, setCube] = useState<string | null>(null);
  const [csvText, setCsvText] = useState('');
  const [previewLines, setPreviewLines] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setCube(cubes[0]?.cube ?? null);
    setCsvText('');
    setPreviewLines([]);
    setErrorBanner(null);
  }, [open]);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsvText(text);
      setPreviewLines(text.split(/\r?\n/).slice(0, 5).filter(Boolean));
    };
    reader.readAsText(file);
    return false;
  };

  const submit = async () => {
    setErrorBanner(null);
    if (!name.trim()) {
      message.error('Name is required.');
      return;
    }
    if (!cube) {
      message.error('Pick a cube with a mapped identity field.');
      return;
    }
    if (!csvText.trim()) {
      message.error('CSV is empty.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<ImportResponse>('/api/segments/import-ids', {
        method: 'POST',
        body: { name: name.trim(), cube, csv: csvText },
      });
      const blurb = `${res.uid_count} uids${res.truncated ? ` (truncated at ${res.max_rows})` : ''}`;
      message.success(`Segment created: ${blurb}.`);
      onCreated?.(res.id);
      onClose();
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={open}
      onCancel={onClose}
      title="Import IDs"
      width={560}
      footer={null}
      destroyOnClose
    >
      <div className={styles.modalContent}>
        {errorBanner && <Alert type="error" message={errorBanner} closable />}

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>Segment name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. VIP list (June 2026)"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>Cube</label>
          <Select
            value={cube ?? undefined}
            onChange={(v) => setCube(v as string)}
            placeholder="Select a cube with mapped identity field"
            options={cubes.map((c) => ({
              value: c.cube,
              label: `${c.cube} (${c.identity_field})`,
            }))}
          />
          {cubes.length === 0 && (
            <small style={{ color: 'var(--text-secondary)' }}>
              No cubes have an identity dim set. Configure one in{' '}
              <a href="#/segments/identity-map">Segments → Identity mapping</a>.
            </small>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>CSV file (one uid per line)</label>
          <Upload.Dragger
            accept=".csv,.txt"
            beforeUpload={handleFile}
            multiple={false}
            showUploadList={false}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p>Click or drag a CSV / text file with one uid per line.</p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Max 5,000 rows. Optional header column named user_id / uid / id.
            </p>
          </Upload.Dragger>
          {previewLines.length > 0 && (
            <div className={styles.summaryCard} style={{ marginTop: 8 }}>
              <div className={styles.summaryHeading}>Preview (first {previewLines.length} lines)</div>
              <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {previewLines.join('\n')}
              </pre>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="primary" loading={submitting} onClick={submit}>
            Create segment
          </Button>
        </div>
      </div>
    </Modal>
  );
}
