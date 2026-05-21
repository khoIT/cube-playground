/* global React, ReactDOM */
const { useState, useEffect, useRef } = React;

// Icon helper — wraps Remix Icon (line style by default). Pass `fill` for filled variant.
// Names use the suffix-less form, e.g. "home-5" or "user".
const Icon = ({ name, size = 16, color, fill, style, ...rest }) => {
  const suffix = fill ? 'fill' : 'line';
  return <i className={`ri-${name}-${suffix}`} style={{ fontSize: size, color, lineHeight: 1, display: 'inline-flex', ...style }} {...rest} />;
};

const cx = (...a) => a.filter(Boolean).join(' ');

// Button
const Button = ({ variant = 'primary', size = 'default', children, leftIcon, rightIcon, onClick, disabled, style, ...rest }) => {
  const sizes = {
    default: { padding: '8px 14px', fontSize: 14, height: 36, gap: 6 },
    small:   { padding: '6px 12px', fontSize: 13, height: 32, gap: 6 },
    mini:    { padding: '4px 8px',  fontSize: 12, height: 24, gap: 4 },
    large:   { padding: '10px 18px',fontSize: 15, height: 44, gap: 8 },
    icon:    { padding: 0, fontSize: 14, height: 36, width: 36, gap: 0, justifyContent: 'center' },
  };
  const variants = {
    primary:     { background: '#f05a22', color: '#fff',    border: '1px solid #f05a22' },
    neutral:     { background: '#171717', color: '#fafafa', border: '1px solid #171717' },
    secondary:   { background: '#f5f5f5', color: '#171717', border: '1px solid transparent' },
    outline:     { background: '#fff',    color: '#171717', border: '1px solid #e5e5e5' },
    ghost:       { background: 'transparent', color: '#171717', border: '1px solid transparent' },
    destructive: { background: '#dc2626', color: '#fff',    border: '1px solid #dc2626' },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, sans-serif', fontWeight: 500, letterSpacing: '-0.005em',
      borderRadius: 9999, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1, lineHeight: 1, whiteSpace: 'nowrap',
      transition: 'background .15s, color .15s, border-color .15s',
      ...sizes[size], ...variants[variant], ...style,
    }} onMouseEnter={e => {
      if (disabled) return;
      if (variant === 'primary') e.currentTarget.style.background = '#f54a00';
      else if (variant === 'neutral') e.currentTarget.style.background = '#262626';
      else if (variant === 'outline') e.currentTarget.style.background = '#fafafa';
      else if (variant === 'ghost') e.currentTarget.style.background = '#f5f5f5';
      else if (variant === 'secondary') e.currentTarget.style.background = '#e5e5e5';
      else if (variant === 'destructive') e.currentTarget.style.background = '#b91c1c';
    }} onMouseLeave={e => { e.currentTarget.style.background = variants[variant].background; }} {...rest}>
      {leftIcon && <Icon name={leftIcon} size={size === 'mini' ? 12 : 16} />}
      {children}
      {rightIcon && <Icon name={rightIcon} size={size === 'mini' ? 12 : 16} />}
    </button>
  );
};

// Badge
const Badge = ({ variant = 'secondary', children, dot, pill, style }) => {
  const v = {
    primary:     { background: '#171717', color: '#fafafa' },
    brand:       { background: '#f05a22', color: '#fff' },
    secondary:   { background: '#f5f5f5', color: '#171717' },
    outline:     { background: '#fff', color: '#171717', border: '1px solid #e5e5e5' },
    destructive: { background: '#dc2626', color: '#fff' },
    success:     { background: '#d1fae5', color: '#065f46' },
    warning:     { background: '#fef3c7', color: '#92400e' },
    info:        { background: '#dbeafe', color: '#1e40af' },
  }[variant];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 12, lineHeight: 1.4,
      padding: '2px 10px', borderRadius: pill === false ? 6 : 9999, border: '1px solid transparent',
      ...v, ...style,
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 9999, background: 'currentColor', opacity: 0.8 }} />}
      {children}
    </span>
  );
};

// Input
const Input = ({ leftIcon, rightIcon, error, onChange, value, placeholder, type = 'text', style, ...rest }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 12px', height: 36, boxSizing: 'border-box',
    border: `1px solid ${error ? '#dc2626' : '#e5e5e5'}`, borderRadius: 8,
    background: '#fff', transition: 'border-color .15s, box-shadow .15s',
    ...style,
  }}
  onFocus={e => { e.currentTarget.style.borderColor = '#a3a3a3'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(163,163,163,0.15)'; }}
  onBlur={e => { e.currentTarget.style.borderColor = error ? '#dc2626' : '#e5e5e5'; e.currentTarget.style.boxShadow = 'none'; }}
  >
    {leftIcon && <Icon name={leftIcon} size={16} color="#737373" />}
    <input type={type} value={value} onChange={onChange} placeholder={placeholder} style={{
      border: 0, outline: 0, flex: 1, fontFamily: 'Geist, sans-serif', fontSize: 13, color: '#171717', background: 'transparent',
    }} {...rest} />
    {rightIcon && <Icon name={rightIcon} size={16} color="#737373" style={{ cursor: 'pointer' }} />}
  </div>
);

// Card
const Card = ({ children, style, padding = 20 }) => (
  <div style={{
    background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10,
    boxShadow: '0 1px 2px -1px rgba(0,0,0,0.1), 0 1px 3px 0 rgba(0,0,0,0.1)',
    padding, ...style,
  }}>{children}</div>
);

// Avatar
const Avatar = ({ name = '?', size = 40, color, src }) => {
  const init = name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  const palette = ['linear-gradient(135deg,#f05a22,#7c2d12)','linear-gradient(135deg,#3f8dff,#1e40af)','linear-gradient(135deg,#059669,#065f46)','linear-gradient(135deg,#a855f7,#6b21a8)','linear-gradient(135deg,#dc2626,#7f1d1d)'];
  const bg = color || palette[name.charCodeAt(0) % palette.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: 9999,
      background: src ? `url(${src}) center/cover` : bg, color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: size * 0.36,
      flexShrink: 0, boxSizing: 'border-box',
    }}>
      {!src && init}
    </div>
  );
};

// Switch
const Switch = ({ checked, onChange, brand }) => (
  <div onClick={() => onChange?.(!checked)} style={{
    width: 36, height: 20, borderRadius: 9999, cursor: 'pointer',
    background: checked ? (brand ? '#f05a22' : '#171717') : '#e5e5e5',
    position: 'relative', transition: 'background .15s',
  }}>
    <div style={{
      position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16,
      borderRadius: 9999, background: '#fff', transition: 'left .15s',
      boxShadow: '0 1px 2px -1px rgba(0,0,0,0.2), 0 1px 3px 0 rgba(0,0,0,0.1)',
    }} />
  </div>
);

// Tabs (segmented)
const Tabs = ({ tabs, value, onChange }) => (
  <div style={{ display: 'inline-flex', background: 'rgba(10,10,10,0.05)', borderRadius: 10, padding: 3, gap: 2 }}>
    {tabs.map(t => (
      <span key={t.value} onClick={() => onChange(t.value)} style={{
        fontFamily: 'Geist, sans-serif', fontWeight: 500, fontSize: 13, color: '#0a0a0a',
        padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
        background: value === t.value ? '#fff' : 'transparent',
        boxShadow: value === t.value ? '0 1px 2px -1px rgba(0,0,0,0.1), 0 1px 3px 0 rgba(0,0,0,0.1)' : 'none',
      }}>{t.label}</span>
    ))}
  </div>
);

// Divider
const Divider = ({ vertical, style }) => (
  <div style={{ background: '#e5e5e5', ...(vertical ? { width: 1, alignSelf: 'stretch' } : { height: 1, width: '100%' }), ...style }} />
);

// Logo — real PNGs from brand assets
const VNGGamesLogo = ({ height = 24, dark }) => (
  <img src={`../../assets/logo/vnggames-${dark ? 'dark' : 'light'}.png`} alt="VNGGames" style={{ height, display: 'block' }} />
);
const AppMark = ({ size = 32, dark }) => (
  <img src={`../../assets/logo/appmark-${dark ? 'dark' : 'light'}.png`} alt="Player Hub" style={{ width: size, height: size, display: 'block' }} />
);
const LevelUpLogo = ({ height = 24 }) => (
  <img src="../../assets/logo/levelup.png" alt="LevelUp" style={{ height, display: 'block' }} />
);
// Legacy aliases for the UI kit's earlier screens
const PlayerHubMark = AppMark;
const PlayerHubWordmark = VNGGamesLogo;

Object.assign(window, { Icon, Button, Badge, Input, Card, Avatar, Switch, Tabs, Divider, VNGGamesLogo, AppMark, LevelUpLogo, PlayerHubMark, PlayerHubWordmark, cx });
