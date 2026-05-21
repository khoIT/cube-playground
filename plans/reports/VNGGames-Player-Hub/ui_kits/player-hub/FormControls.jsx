/* global React */
const { useState: useStateRC } = React;

// Checkbox — supports unchecked / checked / indeterminate, error, disabled
const Checkbox = ({ checked, indeterminate, onChange, disabled, error, label, description, style }) => {
  const box = (
    <span style={{
      width: 18, height: 18, borderRadius: 5, boxSizing: 'border-box',
      border: `1.5px solid ${error ? '#dc2626' : (checked || indeterminate) ? '#f05a22' : '#a3a3a3'}`,
      background: (checked || indeterminate) ? '#f05a22' : '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, transition: 'background .15s, border-color .15s',
      opacity: disabled ? 0.5 : 1,
    }}>
      {indeterminate
        ? <span style={{ width: 10, height: 2, background: '#fff', borderRadius: 1 }} />
        : checked ? <i className="ri-check-line" style={{ fontSize: 14, color: '#fff', lineHeight: 1 }} /> : null}
    </span>
  );
  if (!label) return <span onClick={() => !disabled && onChange?.(!checked)} style={{ cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-flex' }}>{box}</span>;
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'flex-start', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: disabled ? '#a3a3a3' : '#171717',
      lineHeight: 1.4, ...style,
    }} onClick={e => { if (disabled) { e.preventDefault(); return; } onChange?.(!checked); }}>
      {box}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>{label}</span>
        {description && <span style={{ fontWeight: 400, fontSize: 12, color: '#737373' }}>{description}</span>}
      </span>
    </label>
  );
};

// Radio — single radio button
const Radio = ({ checked, onChange, disabled, error, label, description, style }) => {
  const dot = (
    <span style={{
      width: 18, height: 18, borderRadius: 9999, boxSizing: 'border-box',
      border: `1.5px solid ${error ? '#dc2626' : checked ? '#f05a22' : '#a3a3a3'}`,
      background: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, transition: 'border-color .15s',
      opacity: disabled ? 0.5 : 1,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: 9999, background: '#f05a22',
        transform: checked ? 'scale(1)' : 'scale(0)', transition: 'transform .15s',
      }} />
    </span>
  );
  if (!label) return <span onClick={() => !disabled && onChange?.()} style={{ cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-flex' }}>{dot}</span>;
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'flex-start', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: disabled ? '#a3a3a3' : '#171717',
      lineHeight: 1.4, ...style,
    }} onClick={e => { if (disabled) { e.preventDefault(); return; } onChange?.(); }}>
      {dot}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>{label}</span>
        {description && <span style={{ fontWeight: 400, fontSize: 12, color: '#737373' }}>{description}</span>}
      </span>
    </label>
  );
};

// RadioGroup — manages single-select across a list of { value, label, description }
const RadioGroup = ({ value, onChange, options, cards, style }) => (
  <div style={{ display: cards ? 'grid' : 'flex', flexDirection: cards ? undefined : 'column', gridTemplateColumns: cards ? 'repeat(auto-fit, minmax(220px, 1fr))' : undefined, gap: cards ? 10 : 8, ...style }}>
    {options.map(o => {
      const on = value === o.value;
      if (!cards) return <Radio key={o.value} checked={on} onChange={() => onChange(o.value)} label={o.label} description={o.description} disabled={o.disabled} />;
      return (
        <label key={o.value} onClick={() => !o.disabled && onChange(o.value)} style={{
          display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 10,
          border: `1px solid ${on ? '#f05a22' : '#e5e5e5'}`, background: on ? '#fff7ed' : '#fff',
          cursor: o.disabled ? 'not-allowed' : 'pointer', opacity: o.disabled ? 0.5 : 1,
          fontFamily: 'Inter, sans-serif', alignItems: 'flex-start',
        }}>
          <Radio checked={on} style={{ marginTop: 1 }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: '#171717' }}>{o.label}</span>
            {o.description && <span style={{ fontWeight: 400, fontSize: 12, color: '#737373', lineHeight: 1.4 }}>{o.description}</span>}
          </span>
        </label>
      );
    })}
  </div>
);

Object.assign(window, { Checkbox, Radio, RadioGroup });
