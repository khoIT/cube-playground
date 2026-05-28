/* global React, Icon, Button, Badge, Card, Avatar, Tabs, Switch, Input, Divider */
const { useState: useStateP } = React;

// Stat card
const StatCard = ({ label, value, trend, trendDir = 'up', icon }) => (
  <Card padding={18}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <span style={{ fontFamily: 'Inter', fontSize: 11, color: '#737373', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</span>
      <Icon name={icon} size={14} color="#737373" />
    </div>
    <div style={{ fontFamily: 'Geist', fontWeight: 700, fontSize: 26, color: '#0a0a0a', letterSpacing: '-0.01em', lineHeight: 1 }}>{value}</div>
    {trend && <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'Geist', fontSize: 12, color: trendDir === 'up' ? '#059669' : '#dc2626' }}>
      <Icon name={trendDir === 'up' ? 'arrow-up' : 'arrow-down'} size={12} />{trend}
    </div>}
  </Card>
);

// Game library card
const GameCard = ({ title, hours, level, cover, badge }) => (
  <Card padding={0} style={{ overflow: 'hidden', cursor: 'pointer' }}>
    <div style={{ aspectRatio: '16/9', background: cover, position: 'relative' }}>
      {badge && <div style={{ position: 'absolute', top: 10, left: 10 }}><Badge variant="brand">{badge}</Badge></div>}
      <div style={{ position: 'absolute', bottom: 10, right: 10, background: 'rgba(10,10,10,0.6)', color: '#fff', fontFamily: 'Geist Mono', fontSize: 11, padding: '3px 7px', borderRadius: 6 }}>Lv {level}</div>
    </div>
    <div style={{ padding: 14 }}>
      <div style={{ fontFamily: 'Geist', fontWeight: 600, fontSize: 14, color: '#0a0a0a', marginBottom: 2 }}>{title}</div>
      <div style={{ fontFamily: 'Geist', fontSize: 12, color: '#737373' }}>{hours} hours played</div>
    </div>
  </Card>
);

// Achievement row
const Achievement = ({ title, game, progress, total, rarity = 'common' }) => {
  const pct = Math.min(100, (progress / total) * 100);
  const rColor = { common: '#737373', rare: '#3f8dff', epic: '#a855f7', legendary: '#f05a22' }[rarity];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid #f5f5f5' }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, background: `linear-gradient(135deg, ${rColor}22, ${rColor}44)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name="trophy" size={20} color={rColor} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontFamily: 'Geist', fontWeight: 500, fontSize: 13, color: '#0a0a0a' }}>{title}</span>
          <Badge variant="secondary" style={{ fontSize: 10, padding: '1px 6px', color: rColor, background: `${rColor}15` }}>{rarity}</Badge>
        </div>
        <div style={{ fontFamily: 'Geist', fontSize: 11, color: '#737373', marginBottom: 6 }}>{game} · {progress} / {total}</div>
        <div style={{ height: 4, background: '#f5f5f5', borderRadius: 9999, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: rColor, transition: 'width .3s' }} />
        </div>
      </div>
    </div>
  );
};

// Friend row
const FriendRow = ({ name, status, game, onChallenge }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8 }}>
    <div style={{ position: 'relative' }}>
      <Avatar name={name} size={36} />
      <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: 9999, background: status === 'online' ? '#10b981' : status === 'in-game' ? '#f05a22' : '#a3a3a3', border: '2px solid #fff' }} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: 'Geist', fontWeight: 500, fontSize: 13, color: '#0a0a0a' }}>{name}</div>
      <div style={{ fontFamily: 'Geist', fontSize: 11, color: status === 'in-game' ? '#f05a22' : '#737373' }}>{status === 'in-game' ? `Playing ${game}` : status === 'online' ? 'Online' : 'Offline'}</div>
    </div>
    {status === 'in-game' && <Button variant="outline" size="mini" onClick={onChallenge}>Challenge</Button>}
  </div>
);

Object.assign(window, { StatCard, GameCard, Achievement, FriendRow });
