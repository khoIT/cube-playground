/**
 * Redesigned 360 sections — monetization band (primary stat + LTV split bar),
 * profile/status groups (clusters + status chips), acquisition strip
 * (timeline + categorical chips). Asserts dedupe decisions and graceful
 * degradation on missing values, for both cfm and ballistar configs.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MonetizationBand } from '../sections/monetization-band';
import { ProfileStatusGroups } from '../sections/profile-status-groups';
import { AcquisitionStrip } from '../sections/acquisition-strip';
import { sectionsForGame, qualify, profileMembers } from '../member360-sections';

const CFM = sectionsForGame('cfm_vn')!;
const BALLISTAR = sectionsForGame('ballistar')!;

/** Whale-ish profile row keyed by qualified member names. */
function profileRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const bare: Record<string, unknown> = {
    user_id: 'u1',
    ltv_vnd: 10_286_465_000,
    ltv_iap_vnd: 3_090_000_000,
    ltv_web_vnd: 6_860_000_000,
    ltv_30d_vnd: 45_200_000,
    lifetime_txn_count: 1247,
    txn_count_30d: 18,
    first_recharge_date: '2025-01-12',
    last_recharge_date: '2026-06-04',
    country: 'VN',
    os_platform: 'android',
    first_device_model: 'SM-S918B',
    last_server_id: 'S142',
    last_login_country: 'VN',
    max_role_level: 78,
    max_vip_level: 10,
    days_since_install: 412,
    days_since_last_active: 0,
    engagement_segment: 'hardcore',
    lifecycle_stage: 'active_today',
    install_date: '2025-04-21',
    first_login_date: '2025-04-21',
    last_login_date: '2026-06-07',
    media_source: 'organic',
    first_login_channel: 'zalo',
    is_paid_install: 0,
    is_paying_user: 1,
    ...over,
  };
  return Object.fromEntries(Object.entries(bare).map(([k, v]) => [qualify(k), v]));
}

describe('MonetizationBand', () => {
  it('renders compact primary with exact tooltip, split bar legend, and NO paying tile', () => {
    render(<MonetizationBand config={CFM.monetization} row={profileRow()} />);
    const primary = screen.getByText('₫10.29B');
    expect(primary.getAttribute('title')).toMatch(/10.286.465.000/);
    // Split legend with derived Other remainder.
    expect(screen.getByText(/IAP ₫3.09B \(30%\)/)).toBeTruthy();
    expect(screen.getByText(/Web ₫6.86B \(67%\)/)).toBeTruthy();
    expect(screen.getByText(/Other/)).toBeTruthy();
    // Paying flag lives in the hero badges only.
    expect(screen.queryByText(/^Paying$/)).toBeNull();
    expect(screen.queryByText('Yes')).toBeNull();
  });

  it('omits the split bar when totals are zero/null', () => {
    const { container } = render(
      <MonetizationBand
        config={CFM.monetization}
        row={profileRow({ ltv_vnd: 0, ltv_iap_vnd: null, ltv_web_vnd: null })}
      />,
    );
    expect(container.querySelector('[role="img"]')).toBeNull();
  });
});

describe('ProfileStatusGroups', () => {
  it('renders cluster subheads, status chips, and tenure form', () => {
    render(<ProfileStatusGroups groups={CFM.profileGroups} statusChips={CFM.statusChips} row={profileRow()} />);
    expect(screen.getByText('Identity')).toBeTruthy();
    expect(screen.getByText('Progression & health')).toBeTruthy();
    expect(screen.getByText('hardcore')).toBeTruthy();
    expect(screen.getByText('active_today')).toBeTruthy();
    expect(screen.getByText('412d (~1.1y)')).toBeTruthy();
  });

  it('ballistar config (no engagement field) renders without the engagement chip', () => {
    render(
      <ProfileStatusGroups groups={BALLISTAR.profileGroups} statusChips={BALLISTAR.statusChips} row={profileRow()} />,
    );
    expect(screen.queryByText('hardcore')).toBeNull();
    expect(screen.getByText('active_today')).toBeTruthy();
  });
});

describe('AcquisitionStrip', () => {
  it('renders timeline steps with relative context and categorical chips', () => {
    render(<AcquisitionStrip timeline={CFM.acquisitionTimeline} chips={CFM.acquisitionChips} row={profileRow()} />);
    expect(screen.getByText('Install')).toBeTruthy();
    expect(screen.getAllByText('21 Apr 2025').length).toBe(2); // install + first login
    expect(screen.getByText('organic')).toBeTruthy();
    expect(screen.getByText('zalo')).toBeTruthy();
    // Paid-install flag reads as organic/paid chip, not Yes/No.
    expect(screen.getByText('organic install')).toBeTruthy();
    expect(screen.queryByText('No')).toBeNull();
  });

  it('paid install flips the chip', () => {
    render(
      <AcquisitionStrip
        timeline={CFM.acquisitionTimeline}
        chips={CFM.acquisitionChips}
        row={profileRow({ is_paid_install: 1 })}
      />,
    );
    expect(screen.getByText('paid install')).toBeTruthy();
  });
});

describe('profileMembers — cache coverage set', () => {
  it('still includes split + badge fields and dropped install_month stays out', () => {
    const members = profileMembers(CFM);
    expect(members).toContain('user_profile.ltv_iap_vnd');
    expect(members).toContain('user_profile.is_paying_user'); // hero badge
    expect(members).not.toContain('user_profile.install_month'); // deduped out
  });
});
