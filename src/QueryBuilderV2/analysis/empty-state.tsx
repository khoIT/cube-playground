import { useState } from 'react';
import { Button, Empty, Popover, Tooltip } from 'antd';
import { Flow, Paragraph } from '@cube-dev/ui-kit';

interface EmptyStateProps {
  title: string;
  description: string;
  helpBullets: string[];
  onTrySample: () => void;
  canTrySample: boolean;
  disabledReason?: string;
}

export function EmptyState({
  title,
  description,
  helpBullets,
  onTrySample,
  canTrySample,
  disabledReason,
}: EmptyStateProps) {
  const [isBusy, setIsBusy] = useState(false);

  const handleClick = async () => {
    setIsBusy(true);
    try {
      await Promise.resolve(onTrySample());
    } finally {
      setIsBusy(false);
    }
  };

  const trigger = (
    <Button type="primary" disabled={!canTrySample || isBusy} loading={isBusy} onClick={handleClick}>
      Try sample
    </Button>
  );

  return (
    <Empty
      description={
        <Flow gap=".5x" placeItems="center">
          <Paragraph preset="t3m">{title}</Paragraph>
          <Paragraph color="#dark-03">{description}</Paragraph>
          <Flow gap=".5x" style={{ flexDirection: 'row' as const }}>
            {canTrySample ? trigger : <Tooltip title={disabledReason}>{trigger}</Tooltip>}
            <Popover
              trigger="click"
              placement="bottom"
              content={
                <Flow gap=".25x" style={{ maxWidth: 320 }}>
                  {helpBullets.map((bullet, i) => (
                    <Paragraph key={i}>• {bullet}</Paragraph>
                  ))}
                </Flow>
              }
            >
              <Button type="link">What does this do?</Button>
            </Popover>
          </Flow>
        </Flow>
      }
    />
  );
}
