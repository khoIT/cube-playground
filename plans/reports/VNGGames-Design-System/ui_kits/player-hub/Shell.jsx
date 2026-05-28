/* global React, Icon, Button, Badge, Avatar, PlayerHubMark, PlayerHubWordmark */
const { useState: useStateS } = React;

const navItems = [
  { icon: 'home-5', label: 'Overview', key: 'overview' },
  { icon: 'gamepad', label: 'My Games', key: 'games' },
  { icon: 'trophy', label: 'Achievements', key: 'achievements' },
  { icon: 'archive', label: 'Inventory', key: 'inventory' },
  { icon: 'group', label: 'Friends', key: 'friends' },
  { icon: 'wallet-3', label: 'Wallet', key: 'wallet' },
  { icon: 'notification-3', label: 'Notifications', key: 'notifications', badge: 3 },
  { icon: 'settings-3', label: 'Settings', key: 'settings' },
];

function Sidebar({ active, onNav, collapsed }) {
  return (
    <aside style={{
      width: collapsed ? 64 : 248, background: '#fff', borderRight: '1px solid #e5e5e5',
      display: 'flex', flexDirection: 'column', flexShrink: 0, transition: 'width .2s',
    }}>
      <div style={{ padding: '18px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: 10, height: 64, boxSizing: 'border-box' }}>
        <PlayerHubMark size={32} />
        {!collapsed && <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span style={{ fontFamily: 'Geist', fontWeight: 700, fontSize: 15, color: '#0a0a0a', letterSpacing: '-0.01em' }}>Player Hub</span>
          <span style={{ fontFamily: 'Inter', fontSize: 10, color: '#737373', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>VNGGames</span>
        </div>}
      </div>
      <nav style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {navItems.map(item => {
          const isActive = active === item.key;
          return (
            <div key={item.key} onClick={() => onNav(item.key)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? '10px' : '8px 10px',
              borderRadius: 8, cursor: 'pointer',
              background: isActive ? '#f5f5f5' : 'transparent',
              color: isActive ? '#0a0a0a' : '#525252',
              fontFamily: 'Geist', fontWeight: isActive ? 500 : 400, fontSize: 13,
              justifyContent: collapsed ? 'center' : 'flex-start', position: 'relative',
            }} onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#fafafa' }}
               onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}>
              <Icon name={item.icon} size={16} />
              {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
              {!collapsed && item.badge && <Badge variant="primary" pill style={{ fontSize: 10, padding: '1px 6px' }}>{item.badge}</Badge>}
            </div>
          );
        })}
      </nav>
      <div style={{ padding: 12, borderTop: '1px solid #e5e5e5' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 6, borderRadius: 8 }}>
          <Avatar name="Jade Nguyen" size={collapsed ? 32 : 36} />
          {!collapsed && <>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span style={{ fontFamily: 'Geist', fontWeight: 500, fontSize: 13, color: '#0a0a0a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Jade Nguyen</span>
              <span style={{ fontFamily: 'Geist', fontSize: 11, color: '#737373' }}>Level 42 · VIP</span>
            </div>
            <Icon name="arrow-right-s" size={14} color="#737373" />
          </>}
        </div>
      </div>
    </aside>
  );
}

function TopBar({ onToggle, title }) {
  return (
    <header style={{
      height: 64, background: '#fff', borderBottom: '1px solid #e5e5e5',
      display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16, flexShrink: 0,
    }}>
      <Button variant="ghost" size="icon" onClick={onToggle}><Icon name="menu" size={18} /></Button>
      <h1 style={{ fontFamily: 'Geist', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', color: '#0a0a0a', margin: 0, flex: 1 }}>{title}</h1>
      <div style={{ position: 'relative', width: 320 }}>
        <div style={{ position: 'absolute', left: 12, top: 10, pointerEvents: 'none' }}><Icon name="search" size={16} color="#737373" /></div>
        <input placeholder="Search games, players, items…" style={{
          width: '100%', height: 36, padding: '0 12px 0 36px', boxSizing: 'border-box',
          border: '1px solid #e5e5e5', borderRadius: 8, fontFamily: 'Geist', fontSize: 13,
          outline: 0, background: '#fafafa',
        }} />
      </div>
      <Button variant="ghost" size="icon"><Icon name="gift" size={18} /></Button>
      <Button variant="ghost" size="icon" style={{ position: 'relative' }}>
        <Icon name="notification-3" size={18} />
        <span style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 9999, background: '#f05a22', border: '2px solid #fff' }} />
      </Button>
      <Avatar name="Jade Nguyen" size={36} />
    </header>
  );
}

Object.assign(window, { Sidebar, TopBar });
