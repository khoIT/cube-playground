/* global React */
/* Compass primitives — forked from VNG Player Hub kit, adapted for a data product.
   - Uses CSS vars from compass-tokens.css so themability is easy
   - Square-ish radii (--radius-md, 8px) rather than fully pill — more "tool" than "app"
   - Lucide icons via CDN web font fallback to inline SVGs we define here */
const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;

const cx = (...a) => a.filter(Boolean).join(' ');

// -------- Icon --------
// Renders Lucide icons as inline SVG owned by React (no DOM mutation).
// Reads from window.lucide. The bundle exposes icons as PascalCase keys
// (e.g. `lucide.LibraryBig`); we accept kebab-case names and convert.
const _toPascal = (s) => s.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join("");
const _lookupLucide = (name) => {
  if (typeof window === "undefined" || !window.lucide) return null;
  const L = window.lucide;
  const pascal = _toPascal(name);
  // Try every shape lucide UMD bundles have used over versions
  return (L.icons && L.icons[name])
      || (L.icons && L.icons[pascal])
      || L[pascal]
      || L[name]
      || null;
};
const _renderLucideNode = (node, i) => {
  if (!Array.isArray(node)) return null;
  const [tag, attrs, children] = node;
  const reactAttrs = { key: i };
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const mapped = k === "stroke-width" ? "strokeWidth"
        : k === "stroke-linecap" ? "strokeLinecap"
        : k === "stroke-linejoin" ? "strokeLinejoin"
        : k === "fill-rule" ? "fillRule"
        : k === "clip-rule" ? "clipRule"
        : k === "stroke-dasharray" ? "strokeDasharray"
        : k === "stroke-miterlimit" ? "strokeMiterlimit"
        : k;
      reactAttrs[mapped] = attrs[k];
    }
  }
  const kids = Array.isArray(children) ? children.map(_renderLucideNode) : null;
  return React.createElement(tag, reactAttrs, kids);
};
const _iconWarnCache = new Set();
const Icon = ({ name, size = 16, color = "currentColor", strokeWidth = 1.75, style, className, ...rest }) => {
  const entry = _lookupLucide(name);
  if (!entry) {
    if (typeof window !== "undefined" && !_iconWarnCache.has(name)) {
      _iconWarnCache.add(name);
      console.warn(`[Compass] Lucide icon '${name}' not found`);
    }
    return <span style={{ width: size, height: size, display: "inline-block", ...style }} className={className} />;
  }
  // Lucide entries come in two shapes across versions:
  //   1) Array: ["svg", attrs, children]
  //   2) Array: just the children nodes (newer bundles where the svg wrapper is stripped)
  // We always wrap in our own <svg/> so behavior is identical.
  let children;
  if (Array.isArray(entry) && typeof entry[0] === "string" && entry[0] === "svg") {
    children = entry[2];
  } else if (Array.isArray(entry)) {
    children = entry;
  } else if (entry && Array.isArray(entry.children)) {
    children = entry.children;
  } else if (entry && Array.isArray(entry[2])) {
    children = entry[2];
  } else {
    children = null;
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "inline-block", flexShrink: 0, verticalAlign: "middle", ...style }}
      className={className}
      {...rest}
    >
      {Array.isArray(children) ? children.map(_renderLucideNode) : null}
    </svg>
  );
};

// -------- Button --------
const Button = ({ variant = "outline", size = "md", children, leftIcon, rightIcon, onClick, disabled, active, style, title, type = "button", ...rest }) => {
  const sizes = {
    xs: { h: 24, px: 8,  fs: 12, gap: 4, iconSize: 12 },
    sm: { h: 30, px: 10, fs: 13, gap: 6, iconSize: 14 },
    md: { h: 34, px: 12, fs: 13, gap: 6, iconSize: 14 },
    lg: { h: 40, px: 16, fs: 14, gap: 8, iconSize: 16 },
    icon: { h: 32, px: 0, fs: 13, gap: 0, iconSize: 16, w: 32 },
    iconSm: { h: 28, px: 0, fs: 13, gap: 0, iconSize: 14, w: 28 },
  };
  const variants = {
    primary:    { bg: "var(--primary)", color: "#fff", border: "1px solid var(--primary)", hover: "var(--primary-hover)" },
    neutral:    { bg: "var(--neutral-900)", color: "#fff", border: "1px solid var(--neutral-900)", hover: "var(--neutral-800)" },
    secondary:  { bg: "var(--neutral-100)", color: "var(--neutral-900)", border: "1px solid transparent", hover: "var(--neutral-200)" },
    outline:    { bg: "#fff", color: "var(--neutral-900)", border: "1px solid var(--border)", hover: "var(--neutral-50)" },
    ghost:      { bg: "transparent", color: "var(--neutral-700)", border: "1px solid transparent", hover: "var(--neutral-100)" },
    destructive:{ bg: "var(--destructive)", color: "#fff", border: "1px solid var(--destructive)", hover: "var(--red-700)" },
    link:       { bg: "transparent", color: "var(--neutral-900)", border: "1px solid transparent", hover: "transparent", underline: true },
  };
  const s = sizes[size]; const v = variants[variant];
  const [hover, setHover] = useState(false);
  const isIcon = size === "icon" || size === "iconSm";
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        height: s.h, width: isIcon ? s.w : undefined, padding: isIcon ? 0 : `0 ${s.px}px`,
        fontFamily: "var(--font-sans)", fontWeight: 500, fontSize: s.fs, letterSpacing: "-0.005em",
        borderRadius: 8, border: v.border, background: (active ? "var(--neutral-100)" : (hover && !disabled ? v.hover : v.bg)),
        color: v.color, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
        lineHeight: 1, whiteSpace: "nowrap", gap: s.gap, textDecoration: v.underline ? "underline" : "none",
        transition: "background .15s, color .15s, border-color .15s",
        ...style,
      }} {...rest}>
      {leftIcon && <Icon name={leftIcon} size={s.iconSize} />}
      {children}
      {rightIcon && <Icon name={rightIcon} size={s.iconSize} />}
    </button>
  );
};

// -------- Badge --------
const Badge = ({ variant = "secondary", children, dot, square, leftIcon, style, onClick }) => {
  const v = {
    secondary:   { bg: "var(--neutral-100)", color: "var(--neutral-800)", border: "transparent" },
    outline:     { bg: "#fff", color: "var(--neutral-800)", border: "var(--border)" },
    neutral:     { bg: "var(--neutral-900)", color: "#fff", border: "transparent" },
    brand:       { bg: "var(--orange-50)", color: "var(--orange-700)", border: "var(--orange-200)" },
    success:     { bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
    warning:     { bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
    danger:      { bg: "#fef2f2", color: "#991b1b", border: "#fecaca" },
    info:        { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
    purple:      { bg: "#f5f3ff", color: "#6b21a8", border: "#e9d5ff" },
  }[variant] || { bg: "var(--neutral-100)", color: "var(--neutral-800)", border: "transparent" };
  return (
    <span onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontFamily: "var(--font-sans)", fontWeight: 500, fontSize: 11, lineHeight: 1.4,
      padding: "2px 8px", borderRadius: square ? 6 : 9999,
      background: v.bg, color: v.color, border: `1px solid ${v.border}`, whiteSpace: "nowrap",
      cursor: onClick ? "pointer" : "default",
      ...style,
    }}>
      {leftIcon && <Icon name={leftIcon} size={11} />}
      {dot && <span style={{ width: 6, height: 6, borderRadius: 9999, background: "currentColor", opacity: 0.9 }} />}
      {children}
    </span>
  );
};

// -------- Input --------
const Input = ({ leftIcon, rightSlot, error, onChange, value, placeholder, type = "text", autoFocus, onKeyDown, size = "md", style, inputStyle, ...rest }) => {
  const [focus, setFocus] = useState(false);
  const heights = { sm: 30, md: 34, lg: 40 };
  const fs = { sm: 12, md: 13, lg: 14 };
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "0 10px",
      height: heights[size], boxSizing: "border-box",
      border: `1px solid ${error ? "var(--destructive)" : (focus ? "var(--neutral-400)" : "var(--border)")}`,
      borderRadius: 8, background: "#fff",
      boxShadow: focus ? "0 0 0 3px rgba(163,163,163,0.15)" : "none",
      transition: "border-color .15s, box-shadow .15s",
      ...style,
    }}>
      {leftIcon && <Icon name={leftIcon} size={14} color="var(--neutral-500)" />}
      <input type={type} value={value} onChange={onChange} placeholder={placeholder} autoFocus={autoFocus} onKeyDown={onKeyDown}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{ border: 0, outline: 0, flex: 1, fontFamily: "var(--font-sans)", fontSize: fs[size], color: "var(--neutral-950)", background: "transparent", padding: 0, ...inputStyle }} {...rest} />
      {rightSlot}
    </div>
  );
};

// -------- Card --------
const Card = ({ children, style, padding = 16, hover, onClick, asLink }) => {
  const [h, setH] = useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        background: "#fff", border: `1px solid ${hover && h ? "var(--neutral-300)" : "var(--border)"}`,
        borderRadius: 12, padding,
        boxShadow: hover && h ? "var(--shadow-md)" : "var(--shadow-xs)",
        transition: "border-color .15s, box-shadow .15s",
        cursor: onClick || asLink ? "pointer" : "default",
        ...style,
      }}>{children}</div>
  );
};

// -------- Avatar --------
const Avatar = ({ name = "?", size = 28, color, src }) => {
  const init = name.split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();
  const palette = ["#f05a22","#3f8dff","#059669","#7c3aed","#dc2626","#0891b2","#db2777"];
  const bg = color || palette[(name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % palette.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: 9999,
      background: src ? `url(${src}) center/cover` : bg, color: "#fff",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: size * 0.4,
      flexShrink: 0, lineHeight: 1, letterSpacing: "-0.01em",
    }}>{!src && init}</div>
  );
};

// -------- Switch --------
const Switch = ({ checked, onChange, brand, size = "md" }) => {
  const w = size === "sm" ? 28 : 34, h = size === "sm" ? 16 : 20, knob = h - 4, off = w - knob - 2;
  return (
    <div onClick={(e) => { e.stopPropagation(); onChange?.(!checked); }} style={{
      width: w, height: h, borderRadius: 9999, cursor: "pointer",
      background: checked ? (brand ? "var(--primary)" : "var(--neutral-900)") : "var(--neutral-300)",
      position: "relative", transition: "background .15s", flexShrink: 0,
    }}>
      <div style={{
        position: "absolute", top: 2, left: checked ? off : 2, width: knob, height: knob,
        borderRadius: 9999, background: "#fff", transition: "left .15s",
        boxShadow: "0 1px 2px -1px rgba(0,0,0,0.2), 0 1px 3px 0 rgba(0,0,0,0.1)",
      }} />
    </div>
  );
};

// -------- Segmented Tabs --------
const Tabs = ({ tabs, value, onChange, size = "md" }) => {
  const heights = { sm: 28, md: 32 };
  const fs = { sm: 12, md: 13 };
  return (
    <div style={{ display: "inline-flex", background: "var(--neutral-100)", borderRadius: 10, padding: 3, gap: 2 }}>
      {tabs.map(t => (
        <span key={t.value} onClick={() => onChange(t.value)} style={{
          fontFamily: "var(--font-sans)", fontWeight: 500, fontSize: fs[size], color: "var(--neutral-900)",
          padding: `0 ${size === "sm" ? 10 : 12}px`, height: heights[size], display: "inline-flex", alignItems: "center", gap: 6,
          borderRadius: 8, cursor: "pointer",
          background: value === t.value ? "#fff" : "transparent",
          boxShadow: value === t.value ? "var(--shadow-xs)" : "none",
        }}>
          {t.icon && <Icon name={t.icon} size={13} />}
          {t.label}
          {t.count != null && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--neutral-500)" }}>{t.count}</span>}
        </span>
      ))}
    </div>
  );
};

// -------- Divider --------
const Divider = ({ vertical, style }) => (
  <div style={{ background: "var(--border)", ...(vertical ? { width: 1, alignSelf: "stretch" } : { height: 1, width: "100%" }), ...style }} />
);

// -------- Tooltip (simple, hover-driven) --------
const Tooltip = ({ children, content, placement = "top", maxWidth = 240 }) => {
  const [show, setShow] = useState(false);
  if (!content) return children;
  return (
    <span style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span style={{
          position: "absolute", zIndex: 1000,
          bottom: placement === "top" ? "calc(100% + 6px)" : undefined,
          top: placement === "bottom" ? "calc(100% + 6px)" : undefined,
          left: "50%", transform: "translateX(-50%)",
          background: "var(--neutral-900)", color: "#fff",
          padding: "6px 10px", borderRadius: 6, fontSize: 12, lineHeight: 1.4,
          maxWidth, width: "max-content", pointerEvents: "none",
          boxShadow: "var(--shadow-md)", fontFamily: "var(--font-sans)", fontWeight: 400,
        }}>{content}</span>
      )}
    </span>
  );
};

// -------- Popover (clickable, controlled by trigger) --------
const Popover = ({ trigger, children, placement = "bottom-start", width = 240, open: openProp, onOpenChange }) => {
  const [openS, setOpenS] = useState(false);
  const open = openProp != null ? openProp : openS;
  const setOpen = (v) => { onOpenChange ? onOpenChange(v) : setOpenS(v); };
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <span onClick={() => setOpen(!open)} style={{ display: "inline-flex" }}>{trigger}</span>
      {open && (
        <div style={{
          position: "absolute", zIndex: 100,
          top: placement.startsWith("bottom") ? "calc(100% + 6px)" : undefined,
          bottom: placement.startsWith("top") ? "calc(100% + 6px)" : undefined,
          left: placement.endsWith("start") ? 0 : undefined,
          right: placement.endsWith("end") ? 0 : undefined,
          width, background: "#fff", border: "1px solid var(--border)", borderRadius: 10,
          boxShadow: "var(--shadow-lg)", padding: 6,
        }}>{typeof children === "function" ? children({ close: () => setOpen(false) }) : children}</div>
      )}
    </span>
  );
};

// -------- Modal --------
const Modal = ({ open, onClose, title, subtitle, children, footer, width = 560, paddingBody = 20 }) => {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,10,10,0.5)",
      display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 80, paddingBottom: 40,
      overflowY: "auto",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width, maxWidth: "calc(100vw - 32px)", background: "#fff", borderRadius: 12,
        boxShadow: "var(--shadow-2xl)", border: "1px solid var(--border)", overflow: "hidden",
      }}>
        {(title || subtitle) && (
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && <div style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 16, color: "var(--neutral-950)", letterSpacing: "-0.01em" }}>{title}</div>}
              {subtitle && <div style={{ fontSize: 13, color: "var(--neutral-500)", marginTop: 2 }}>{subtitle}</div>}
            </div>
            <Button variant="ghost" size="iconSm" onClick={onClose}><Icon name="x" size={16} /></Button>
          </div>
        )}
        <div style={{ padding: paddingBody }}>{children}</div>
        {footer && <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8, background: "var(--neutral-50)" }}>{footer}</div>}
      </div>
    </div>
  );
};

// -------- KBD --------
const Kbd = ({ children }) => <span className="kbd">{children}</span>;

// -------- Empty state --------
const EmptyState = ({ icon = "inbox", title, description, action }) => (
  <div style={{ padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
    <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--neutral-100)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--neutral-500)", marginBottom: 4 }}>
      <Icon name={icon} size={22} />
    </div>
    <div style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 14, color: "var(--neutral-900)" }}>{title}</div>
    {description && <div style={{ fontSize: 13, color: "var(--neutral-500)", maxWidth: 320 }}>{description}</div>}
    {action && <div style={{ marginTop: 12 }}>{action}</div>}
  </div>
);

// -------- Section header --------
const SectionHeader = ({ title, count, action, description }) => (
  <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 12 }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 13, color: "var(--neutral-900)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</span>
        {count != null && <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--neutral-500)" }}>{count}</span>}
      </div>
      {description && <div style={{ fontSize: 12, color: "var(--neutral-500)", marginTop: 2 }}>{description}</div>}
    </div>
    {action}
  </div>
);

// -------- Sparkline (tiny SVG line chart) --------
const Sparkline = ({ data, width = 80, height = 24, color = "var(--neutral-700)", fillBg, lastPointDot = false }) => {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${height - ((v - min) / range) * (height - 4) - 2}`).join(" ");
  const last = data[data.length - 1];
  const lx = (data.length - 1) * step;
  const ly = height - ((last - min) / range) * (height - 4) - 2;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      {fillBg && <polygon points={`0,${height} ${points} ${width},${height}`} fill={fillBg} />}
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {lastPointDot && <circle cx={lx} cy={ly} r={2} fill={color} />}
    </svg>
  );
};

// -------- Toast (very simple) --------
const ToastContext = createContext(null);
const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts, { id, msg, ...opts }]);
    setTimeout(() => setToasts((ts) => ts.filter(t => t.id !== id)), opts.duration || 3000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div style={{ position: "fixed", bottom: 24, right: 24, display: "flex", flexDirection: "column", gap: 8, zIndex: 2000 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: "var(--neutral-900)", color: "#fff", padding: "10px 14px", borderRadius: 10,
            fontSize: 13, fontFamily: "var(--font-sans)", boxShadow: "var(--shadow-lg)",
            display: "flex", alignItems: "center", gap: 8, minWidth: 240,
          }}>
            {t.icon && <Icon name={t.icon} size={14} />}
            <span style={{ flex: 1 }}>{t.msg}</span>
            {t.action && <span onClick={t.action.onClick} style={{ color: "var(--orange-400)", cursor: "pointer", fontWeight: 500 }}>{t.action.label}</span>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
const useToast = () => useContext(ToastContext);

Object.assign(window, {
  cx, Icon, Button, Badge, Input, Card, Avatar, Switch, Tabs, Divider, Tooltip, Popover, Modal, Kbd,
  EmptyState, SectionHeader, Sparkline, ToastProvider, useToast,
});
