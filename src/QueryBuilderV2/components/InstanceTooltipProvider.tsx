import { CubeTooltipProviderProps, tasty, TooltipProvider } from '@cube-dev/ui-kit';
import { RefObject } from 'react';

import { useHasOverflow } from '../hooks';
import { titleize } from '../utils';

const TooltipWrapper = tasty({
  styles: {
    Name: {
      display: 'block',
      width: 'max-content',
      preset: 't4m',
    },

    Title: {
      display: 'block',
      width: 'max-content',
      preset: 't3',
    },

    Description: {
      display: 'block',
      preset: 'p3',
    },

    Type: {
      preset: 'c2',
      opacity: 0.7,
    },
  },
});

interface InstanceTooltipProviderProps {
  name: string;
  fullName?: string;
  title?: string;
  type?: 'dimension' | 'measure' | 'hierarchy' | 'folder' | 'segment';
  description?: string;
  /** Measure-only: aggregation type from `/meta` (Σ / Cnt / ≈ Cnt-D / …). */
  aggType?: string;
  /** Measure-only: display format from `/meta` (e.g. `currency`, `percent`). */
  format?: string;
  forceShown?: boolean;
  children: CubeTooltipProviderProps['children'];
  isDisabled?: boolean;
  overflowRef?: RefObject<HTMLDivElement>;
}

export function InstanceTooltipProvider(props: InstanceTooltipProviderProps) {
  const {
    name,
    fullName,
    type,
    title,
    description,
    aggType,
    format,
    children,
    isDisabled,
    forceShown,
    overflowRef,
  } = props;

  const hasOverflow = useHasOverflow(overflowRef);
  const isAutoTitle = titleize(name) === title;

  // Measures with enrichment data (description, aggType, format) always show
  // the tooltip so users can discover the metric's metadata on hover even
  // when the row name fits without overflow.
  const hasEnrichment = !!(description || aggType || format);
  const skipTooltip =
    !forceShown &&
    (isDisabled ||
      (!hasOverflow && isAutoTitle && !hasEnrichment) ||
      !overflowRef);

  if (skipTooltip || !fullName) {
    return children;
  }

  return (
    <TooltipProvider
      title={
        <>
          <TooltipWrapper>
            {type && <div data-element="Type">{type}</div>}
            <div data-element="Name">{fullName}</div>
            <div data-element="Title">{title}</div>
            {description && <div data-element="Description">{description}</div>}
            {(aggType || format) && (
              <div data-element="Description">
                {aggType && <span>agg: {aggType}</span>}
                {aggType && format && ' · '}
                {format && <span>format: {format}</span>}
              </div>
            )}
          </TooltipWrapper>
        </>
      }
      width="max-content"
      delay={hasEnrichment ? 300 : 1000}
      placement="right"
    >
      {children}
    </TooltipProvider>
  );
}
