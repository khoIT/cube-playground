/**
 * ChangeAnalysisModal — light-weight modal that surfaces the mocked anomaly
 * breakdowns (country / channel / tier) for a metric, plus a "Save as
 * segment" CTA that hands off to the Segments page via URL params.
 *
 * Backdrop click and Esc dismiss. Locked to a single mounted instance per
 * page; consumers control visibility via `open`.
 */

import { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import styled from 'styled-components';

import type {
  BusinessMetric,
  BusinessMetricAnomalyBreakdownRow,
} from '../../pages/Catalog/metrics-tab/business-metric-types';

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const Modal = styled.div`
  width: min(820px, 90vw);
  max-height: 80vh;
  overflow-y: auto;
  background: var(--bg-card);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  padding: 24px;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
`;

const Subtitle = styled.div`
  margin-top: 4px;
  margin-bottom: 16px;
  font-size: 12px;
  color: var(--text-muted);
`;

const Cols = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
`;

const Col = styled.section``;

const ColTitle = styled.h4`
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
`;

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--border-card);
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: 12px;
`;

const Delta = styled.span<{ $negative: boolean }>`
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  color: ${(p) => (p.$negative ? '#b91c1c' : '#047857')};
`;

const Actions = styled.div`
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const Button = styled.button`
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--border-card);
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
`;

const Primary = styled(Button)`
  background: var(--brand);
  border-color: var(--brand);
  color: white;
  &:hover { background: var(--brand-hover); }
`;

const Demo = styled.div`
  margin-bottom: 12px;
  padding: 8px 12px;
  background: rgba(245, 158, 11, 0.10);
  border: 1px solid rgba(245, 158, 11, 0.30);
  border-radius: 6px;
  color: #92400e;
  font-size: 11px;
`;

const Empty = styled.div`
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
`;

function renderRows(
  rows: BusinessMetricAnomalyBreakdownRow[] | undefined,
): React.ReactNode {
  if (!rows || rows.length === 0) return <Empty>No data.</Empty>;
  return rows.map((r) => (
    <Row key={r.label}>
      <span>{r.label}</span>
      <Delta $negative={r.deltaPct < 0}>
        {r.deltaPct >= 0 ? '+' : ''}
        {r.deltaPct.toFixed(1)}%
      </Delta>
    </Row>
  ));
}

interface ChangeAnalysisModalProps {
  open: boolean;
  metric: BusinessMetric;
  onClose: () => void;
}

export function ChangeAnalysisModal({
  open,
  metric,
  onClose,
}: ChangeAnalysisModalProps) {
  const history = useHistory();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const anomaly = metric.anomaly;
  const handleSaveAsSegment = (contributor: string) => {
    history.push(
      `/segments/new?from-anomaly=${encodeURIComponent(metric.id)}:${encodeURIComponent(contributor)}`,
    );
    onClose();
  };

  return (
    <Backdrop onClick={onClose} role="dialog" aria-modal="true">
      <Modal onClick={(e) => e.stopPropagation()}>
        <Title>{metric.label} — change analysis</Title>
        <Subtitle>
          {anomaly?.deltaPct !== undefined && (
            <Delta $negative={anomaly.deltaPct < 0}>
              {anomaly.deltaPct >= 0 ? '+' : ''}
              {anomaly.deltaPct.toFixed(1)}%
            </Delta>
          )}{' '}
          · {anomaly?.period ?? 'recent period'}
        </Subtitle>
        <Demo>Demo data — replaced by live anomaly detector in Phase 8.</Demo>
        <Cols>
          <Col>
            <ColTitle>By country</ColTitle>
            {renderRows(anomaly?.breakdowns?.country)}
          </Col>
          <Col>
            <ColTitle>By channel</ColTitle>
            {renderRows(anomaly?.breakdowns?.channel)}
          </Col>
          <Col>
            <ColTitle>By tier</ColTitle>
            {renderRows(anomaly?.breakdowns?.tier)}
          </Col>
        </Cols>
        <Actions>
          <Button type="button" onClick={onClose}>Close</Button>
          <Primary
            type="button"
            onClick={() =>
              handleSaveAsSegment(
                anomaly?.breakdowns?.country?.[0]?.label ??
                  anomaly?.breakdowns?.channel?.[0]?.label ??
                  'all',
              )
            }
          >
            Save top contributor as segment →
          </Primary>
        </Actions>
      </Modal>
    </Backdrop>
  );
}
