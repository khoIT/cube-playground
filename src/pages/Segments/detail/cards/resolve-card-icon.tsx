/**
 * resolveCardIcon — pick a lucide glyph for a chart-card header from the
 * measure's intent (revenue → banknote, users → people, …), falling back to
 * the card's chart shape. Mirrors the headline-KPI icon heuristic so the
 * detail page reads as one system.
 */

import type { ReactNode } from 'react';
import {
  Activity, Banknote, BarChart3, LineChart, Percent, PieChart, TrendingUp, Users, Wallet,
} from 'lucide-react';

const ICON_SIZE = 14;

export type CardIconFallback = 'lines' | 'bars' | 'donut' | 'chart';

export function resolveCardIcon(measure: string, fallback: CardIconFallback): ReactNode {
  const local = (measure.split('.').pop() ?? measure).toLowerCase();

  if (/revenue|ltv|arpu|arppu|spend|amount|vnd|usd/.test(local)) return <Banknote size={ICON_SIZE} aria-hidden />;
  if (/payer|paying|recharge|purchase/.test(local)) return <Wallet size={ICON_SIZE} aria-hidden />;
  if (/rate|percent|pct|share|ratio/.test(local)) return <Percent size={ICON_SIZE} aria-hidden />;
  if (/retention|active|session|engagement/.test(local)) return <Activity size={ICON_SIZE} aria-hidden />;
  if (/user|uid|player|member|account|install|dau|wau|mau/.test(local)) return <Users size={ICON_SIZE} aria-hidden />;

  switch (fallback) {
    case 'lines': return <LineChart size={ICON_SIZE} aria-hidden />;
    case 'bars': return <BarChart3 size={ICON_SIZE} aria-hidden />;
    case 'donut': return <PieChart size={ICON_SIZE} aria-hidden />;
    default: return <TrendingUp size={ICON_SIZE} aria-hidden />;
  }
}
