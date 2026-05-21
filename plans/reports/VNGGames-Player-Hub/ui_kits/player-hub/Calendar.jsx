/* global React */
const { useState: useStateCal } = React;

/* Minimal Calendar & DatePicker components — plain JS Date, zero external deps.
   Use: <Calendar value={Date|null} onChange={fn} />  or  <DatePicker ...props /> */

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function sameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function isBetween(d, a, b) { return a && b && d > a && d < b; }
function fmt(d) { if (!d) return ''; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_SHORT   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function Calendar({ value, onChange, range, onRangeChange, min, max, disabledFn, style }) {
  const [cursor, setCursor] = useStateCal(startOfMonth(value instanceof Date ? value : (range?.[0] instanceof Date ? range[0] : new Date())));
  const [hover, setHover] = useStateCal(null);
  const today = new Date(); today.setHours(0,0,0,0);

  const monthStart = startOfMonth(cursor);
  const startDow = monthStart.getDay();
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const prevMonthDays = new Date(cursor.getFullYear(), cursor.getMonth(), 0).getDate();

  const dayCell = (d, muted) => {
    const cls = ['day'];
    if (muted) cls.push('mute');
    if (sameDay(d, today)) cls.push('today');
    const disabled = (min && d < min) || (max && d > max) || (disabledFn && disabledFn(d));
    if (disabled) cls.push('disabled');
    if (range) {
      const [a, b] = range;
      if (sameDay(d, a)) cls.push('range-start');
      else if (sameDay(d, b)) cls.push('range-end');
      else if (a && b && isBetween(d, a, b)) cls.push('in-range');
      else if (a && !b && hover && isBetween(d, a, hover)) cls.push('in-range');
    } else if (sameDay(d, value)) cls.push('sel');
    const click = () => {
      if (disabled || muted) return;
      if (range) {
        const [a, b] = range;
        if (!a || (a && b)) onRangeChange?.([d, null]);
        else if (d < a) onRangeChange?.([d, a]);
        else onRangeChange?.([a, d]);
      } else onChange?.(d);
    };
    return <div key={`${cls.join('-')}-${d.getTime()}`} className={cls.join(' ')} onClick={click} onMouseEnter={() => range && setHover(d)}>{d.getDate()}</div>;
  };

  const cells = [];
  for (let i = 0; i < startDow; i++) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - 1, prevMonthDays - startDow + 1 + i);
    cells.push(dayCell(d, true));
  }
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push(dayCell(new Date(cursor.getFullYear(), cursor.getMonth(), i), false));
  }
  const trail = 42 - cells.length;
  for (let i = 1; i <= trail; i++) {
    cells.push(dayCell(new Date(cursor.getFullYear(), cursor.getMonth() + 1, i), true));
  }

  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12,
      padding: 14, boxShadow: '0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.08)',
      width: 268, boxSizing: 'border-box', fontFamily: 'Inter, sans-serif', color: '#171717',
      ...style,
    }}>
      <style>{`
        .cal-day-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
        .cal-day-grid .dow{font-size:11px;color:#737373;font-weight:500;text-align:center;padding:4px 0;text-transform:uppercase;letter-spacing:0.04em}
        .cal-day-grid .day{aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:12.5px;border-radius:8px;cursor:pointer;color:#171717;position:relative;user-select:none}
        .cal-day-grid .day:hover{background:#f5f5f5}
        .cal-day-grid .day.mute{color:#d4d4d4}
        .cal-day-grid .day.today{font-weight:600}
        .cal-day-grid .day.today::after{content:'';position:absolute;bottom:3px;width:4px;height:4px;border-radius:9999px;background:#f05a22}
        .cal-day-grid .day.sel{background:#f05a22;color:#fff;font-weight:600}
        .cal-day-grid .day.sel::after{background:#fff}
        .cal-day-grid .day.sel:hover{background:#f05a22}
        .cal-day-grid .day.in-range{background:#fff7ed;border-radius:0}
        .cal-day-grid .day.range-start{background:#f05a22;color:#fff;font-weight:600;border-top-right-radius:0;border-bottom-right-radius:0}
        .cal-day-grid .day.range-end{background:#f05a22;color:#fff;font-weight:600;border-top-left-radius:0;border-bottom-left-radius:0}
        .cal-day-grid .day.disabled{color:#d4d4d4;cursor:not-allowed;text-decoration:line-through;background:transparent}
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px 10px' }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}</div>
        <div style={{ display: 'inline-flex', gap: 2 }}>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} style={{ width: 28, height: 28, border: 0, background: 'transparent', borderRadius: 6, cursor: 'pointer', color: '#525252' }}>
            <i className="ri-arrow-left-s-line" style={{ fontSize: 16 }} />
          </button>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} style={{ width: 28, height: 28, border: 0, background: 'transparent', borderRadius: 6, cursor: 'pointer', color: '#525252' }}>
            <i className="ri-arrow-right-s-line" style={{ fontSize: 16 }} />
          </button>
        </div>
      </div>
      <div className="cal-day-grid">
        {DOW_SHORT.map(d => <div key={d} className="dow">{d}</div>)}
        {cells}
      </div>
    </div>
  );
}

function DatePicker({ value, onChange, placeholder = 'Pick a date', range, onRangeChange, min, max, disabledFn, style }) {
  const [open, setOpen] = useStateCal(false);
  const display = range ? (range[0] ? (range[1] ? `${fmt(range[0])} — ${fmt(range[1])}` : `${fmt(range[0])} — …`) : '') : fmt(value);
  return (
    <div style={{ position: 'relative', display: 'inline-block', ...style }}>
      <div onClick={() => setOpen(o => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 36,
        border: `1px solid ${open ? '#a3a3a3' : '#e5e5e5'}`, borderRadius: 8, background: '#fff',
        fontSize: 13, color: '#171717', cursor: 'pointer', minWidth: 220, boxSizing: 'border-box',
        fontFamily: 'Inter, sans-serif',
        boxShadow: open ? '0 0 0 3px rgba(163,163,163,0.15)' : 'none',
      }}>
        <i className="ri-calendar-line" style={{ fontSize: 16, color: open ? '#f05a22' : '#737373', lineHeight: 1 }} />
        <span style={{ color: display ? '#171717' : '#a3a3a3' }}>{display || placeholder}</span>
        <span style={{ flex: 1 }} />
        <i className={`ri-arrow-${open ? 'up' : 'down'}-s-line`} style={{ fontSize: 14, color: '#737373', lineHeight: 1 }} />
      </div>
      {open && (
        <div style={{ position: 'absolute', top: 44, left: 0, zIndex: 10 }}>
          <Calendar value={value} onChange={d => { onChange?.(d); setOpen(false); }} range={range} onRangeChange={r => { onRangeChange?.(r); if (r[0] && r[1]) setOpen(false); }} min={min} max={max} disabledFn={disabledFn} />
        </div>
      )}
    </div>
  );
}

Object.assign(window, { Calendar, DatePicker });
