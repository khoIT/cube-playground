import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';

import { LiveBadge } from '../live-badge';
import { MemberPill } from '../member-pill';
import { Tag } from '../tag';
import { SelectionBar } from '../selection-bar';
import { KpiTile } from '../kpi-tile';
import { Breadcrumbs } from '../breadcrumbs';
import { CompositionCard } from '../composition-card';
import { PredicatePill } from '../predicate-pill';
import { LiveBanner } from '../live-banner';
import { FloatingLiveChip } from '../floating-live-chip';
import { LineChart } from '../line-chart';
import { BarList } from '../bar-list';
import { Donut } from '../donut';
import { Sparkline } from '../sparkline';

// recharts uses ResizeObserver internally — stub it for jsdom
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// ─── LiveBadge ────────────────────────────────────────────────────────────────
describe('LiveBadge', () => {
  it('renders label text and has status role', () => {
    render(<LiveBadge label="Live" intervalMin={5} />);
    const el = screen.getByRole('status');
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent('Live');
    expect(el).toHaveTextContent('5m');
  });

  it('renders without intervalMin', () => {
    render(<LiveBadge />);
    expect(screen.getByRole('status')).toHaveTextContent('Live');
  });

  it('renders sm size without error', () => {
    render(<LiveBadge size="sm" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

// ─── MemberPill ───────────────────────────────────────────────────────────────
describe('MemberPill', () => {
  it.each(['measure', 'dimension', 'segment', 'time'] as const)(
    'renders %s variant with children',
    (variant) => {
      render(<MemberPill variant={variant}>users.country</MemberPill>);
      expect(screen.getByText('users.country')).toBeInTheDocument();
    },
  );

  it('renders close button when onClose provided', () => {
    const onClose = vi.fn();
    render(<MemberPill variant="measure" onClose={onClose}>revenue</MemberPill>);
    const btn = screen.getByRole('button', { name: /remove/i });
    expect(btn).toBeInTheDocument();
    btn.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('omits close button when onClose not provided', () => {
    render(<MemberPill variant="dimension">sessions</MemberPill>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// ─── Tag ──────────────────────────────────────────────────────────────────────
describe('Tag', () => {
  it('renders children', () => {
    render(<Tag>gaming</Tag>);
    expect(screen.getByText('gaming')).toBeInTheDocument();
  });

  it('renders remove button when onRemove provided', () => {
    const onRemove = vi.fn();
    render(<Tag onRemove={onRemove}>vip</Tag>);
    const btn = screen.getByRole('button', { name: /remove tag/i });
    btn.click();
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

// ─── SelectionBar ─────────────────────────────────────────────────────────────
describe('SelectionBar', () => {
  it('displays count and renders actions', () => {
    render(
      <SelectionBar count={3} actions={<button>Export</button>} />,
    );
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('renders dismiss button when onDismiss provided', () => {
    const onDismiss = vi.fn();
    render(<SelectionBar count={1} actions={null} onDismiss={onDismiss} />);
    const btn = screen.getByRole('button', { name: /dismiss/i });
    btn.click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

// ─── KpiTile ──────────────────────────────────────────────────────────────────
describe('KpiTile', () => {
  it('renders label and value', () => {
    render(<KpiTile label="DAU" value="1.2M" />);
    expect(screen.getByText('DAU')).toBeInTheDocument();
    expect(screen.getByText('1.2M')).toBeInTheDocument();
  });

  it('renders delta when provided', () => {
    render(<KpiTile label="Revenue" value="$4K" delta="+12.3%" tone="positive" />);
    expect(screen.getByText('+12.3%')).toBeInTheDocument();
  });

  it('renders footer when provided', () => {
    render(<KpiTile label="ARPU" value="$2.50" footer="vs last 30d" />);
    expect(screen.getByText('vs last 30d')).toBeInTheDocument();
  });
});

// ─── Breadcrumbs ──────────────────────────────────────────────────────────────
describe('Breadcrumbs', () => {
  it('renders all items', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Segments' },
          { label: 'High-value players', href: '/segments/1' },
        ]}
      />,
    );
    expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toBeInTheDocument();
    expect(screen.getByText('Segments')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'High-value players' });
    expect(link).toHaveAttribute('href', '/segments/1');
  });
});

// ─── PredicatePill ────────────────────────────────────────────────────────────
describe('PredicatePill', () => {
  it('renders member, op, value', () => {
    render(<PredicatePill member="users.country" op="equals" value="VN" />);
    expect(screen.getByText('users.country')).toBeInTheDocument();
    expect(screen.getByText('equals')).toBeInTheDocument();
    expect(screen.getByText('VN')).toBeInTheDocument();
  });

  it('renders remove button when onRemove provided', () => {
    const onRemove = vi.fn();
    render(
      <PredicatePill member="users.platform" op="=" value="iOS" onRemove={onRemove} />,
    );
    const btn = screen.getByRole('button', { name: /remove condition/i });
    btn.click();
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

// ─── LiveBanner ───────────────────────────────────────────────────────────────
describe('LiveBanner', () => {
  it('renders message and interval', () => {
    render(<LiveBanner message="Segment is live" intervalMin={15} />);
    expect(screen.getByRole('status')).toHaveTextContent('Segment is live');
    expect(screen.getByRole('status')).toHaveTextContent('15m');
  });

  it('renders pause button when onPause provided', () => {
    const onPause = vi.fn();
    render(<LiveBanner message="Live" intervalMin={5} onPause={onPause} />);
    const btn = screen.getByRole('button', { name: /pause/i });
    btn.click();
    expect(onPause).toHaveBeenCalledOnce();
  });
});

// ─── FloatingLiveChip ─────────────────────────────────────────────────────────
describe('FloatingLiveChip', () => {
  it('renders interval text', () => {
    render(<FloatingLiveChip visible intervalMin={10} />);
    expect(screen.getByText(/10m/)).toBeInTheDocument();
  });

  it('is aria-hidden when visible=false', () => {
    render(<FloatingLiveChip visible={false} intervalMin={10} />);
    const el = screen.getByText(/10m/).closest('span');
    expect(el).toHaveAttribute('aria-hidden', 'true');
  });
});

// ─── BarList ──────────────────────────────────────────────────────────────────
describe('BarList', () => {
  const items = [
    { label: 'iOS', value: 5000 },
    { label: 'Android', value: 3200 },
  ];

  it('renders all labels and values', () => {
    render(<BarList items={items} />);
    expect(screen.getByText('iOS')).toBeInTheDocument();
    expect(screen.getByText('Android')).toBeInTheDocument();
    expect(screen.getByText('5,000')).toBeInTheDocument();
    expect(screen.getByText('3,200')).toBeInTheDocument();
  });

  it('renders meter roles', () => {
    render(<BarList items={items} />);
    const meters = screen.getAllByRole('meter');
    expect(meters).toHaveLength(2);
  });

  it('renders a leading chip beside the label when present, and omits it otherwise', () => {
    render(
      <BarList
        items={[
          { label: 'JUS_VN_A70_UA_ASA', value: 9000, chip: 'Apple Search' },
          { label: '23231746441', value: 8000 },
        ]}
      />,
    );
    // chip text shows for the row that has one
    expect(screen.getByText('Apple Search')).toBeInTheDocument();
    // both campaign labels still render
    expect(screen.getByText('JUS_VN_A70_UA_ASA')).toBeInTheDocument();
    expect(screen.getByText('23231746441')).toBeInTheDocument();
    // exactly one chip — the chip-less row gets no chip element
    expect(screen.queryAllByText('Apple Search')).toHaveLength(1);
  });
});

// ─── Donut ────────────────────────────────────────────────────────────────────
describe('Donut', () => {
  const data = [
    { label: 'iOS', value: 60 },
    { label: 'Android', value: 40 },
  ];

  it('renders without throwing', () => {
    const { container } = render(<Donut data={data} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders legend labels in bottom layout', () => {
    render(<Donut data={data} legendPosition="bottom" />);
    expect(screen.getByText('iOS')).toBeInTheDocument();
    expect(screen.getByText('Android')).toBeInTheDocument();
  });
});

// ─── LineChart ────────────────────────────────────────────────────────────────
describe('LineChart', () => {
  const data = [
    { x: 'Jan', y: 100 },
    { x: 'Feb', y: 150 },
    { x: 'Mar', y: 130 },
  ];

  it('renders without throwing', () => {
    const { container } = render(<LineChart data={data} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders with areaFill=false without throwing', () => {
    const { container } = render(<LineChart data={data} areaFill={false} />);
    expect(container.firstChild).toBeTruthy();
  });
});

// ─── Sparkline ────────────────────────────────────────────────────────────────
describe('Sparkline', () => {
  it('renders without throwing', () => {
    const { container } = render(<Sparkline data={[10, 20, 15, 30, 25]} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('accepts custom color and height', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} height={32} color="var(--chart-2)" />,
    );
    expect(container.firstChild).toBeTruthy();
  });
});

// ─── CompositionCard ─────────────────────────────────────────────────────────
describe('CompositionCard', () => {
  it('renders title and bar labels', () => {
    render(
      <CompositionCard
        title="Platform split"
        donutData={[
          { label: 'iOS', value: 60 },
          { label: 'Android', value: 40 },
        ]}
        barData={[
          { label: 'iOS', value: 60 },
          { label: 'Android', value: 40 },
        ]}
      />,
    );
    expect(screen.getByText('Platform split')).toBeInTheDocument();
    expect(screen.getAllByText('iOS').length).toBeGreaterThan(0);
  });
});
