// bk-ui.jsx — shared UI primitives for setlist / editor / settings + component sheet.
// window.BKUI = { TopBar, BottomNav, Toggle, Segmented, Stepper, Slider, ListRow, Field, GroupLabel }
(function () {
  const { useState } = React;

  const TABS = [
    ['연주', 'M7 4l13 8-13 8z'],
    ['셋리스트', 'M4 6h16M4 12h16M4 18h10'],
    ['기록', 'M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-7'],
    ['설정', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l1.5 1-1 2-1.8-.4-1.3 1.3.4 1.8-2 1-1-1.5h-2l-1 1.5-2-1 .4-1.8L4.6 15 2.8 15.4l-1-2L3.3 12 1.8 11l1-2 1.8.4 1.3-1.3L5.5 6.3l2-1 1 1.5h2l1-1.5 2 1-.4 1.8 1.3 1.3 1.8-.4 1 2L19 12z'],
  ];

  function BottomNav({ active = '연주' }) {
    return (
      <nav className="bk-tabs">
        {TABS.map(([l, d], i) => (
          <button key={i} className={'bk-tab' + (l === active ? ' on' : '')}>
            <svg viewBox="0 0 24 24" fill={i === 0 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
            <span>{l}</span>
          </button>
        ))}
      </nav>
    );
  }

  function TopBar({ title, left, right }) {
    return (
      <div className="bk-topbar">
        <div className="bk-tb-side left">{left}</div>
        <div className="bk-tb-title">{title}</div>
        <div className="bk-tb-side right">{right}</div>
      </div>
    );
  }

  function Toggle({ on, onChange }) {
    return (
      <button className={'bk-toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
        <span className="bk-toggle-knob"></span>
      </button>
    );
  }

  function Segmented({ options, value, onChange, full }) {
    return (
      <div className={'bk-seg2' + (full ? ' full' : '')}>
        {options.map(([k, l]) => (
          <button key={k} className={'bk-seg2-b' + (value === k ? ' on' : '')} onClick={() => onChange(k)}>{l}</button>
        ))}
      </div>
    );
  }

  function Stepper({ value, onChange, min = 20, max = 300, step = 1, suffix }) {
    const set = (v) => onChange(Math.max(min, Math.min(max, v)));
    return (
      <div className="bk-stepper">
        <button onClick={() => set(value - step)} aria-label="감소">−</button>
        <div className="bk-stepper-val">{value}{suffix && <i>{suffix}</i>}</div>
        <button onClick={() => set(value + step)} aria-label="증가">+</button>
      </div>
    );
  }

  function Slider({ value, onChange, min = 0, max = 100, step = 1 }) {
    const pct = ((value - min) / (max - min)) * 100;
    return (
      <input type="range" className="bk-slider" min={min} max={max} step={step} value={value}
        style={{ '--pct': pct + '%' }}
        onChange={(e) => onChange(Number(e.target.value))} />
    );
  }

  function ListRow({ grip, title, sub, right, onClick, active, accent }) {
    return (
      <div className={'bk-lrow' + (active ? ' active' : '')} onClick={onClick}>
        {grip && <span className="bk-grip2"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 7h.01M8 12h.01M8 17h.01M16 7h.01M16 12h.01M16 17h.01" /></svg></span>}
        <div className="bk-lrow-main">
          <div className="bk-lrow-title">{title}</div>
          {sub && <div className="bk-lrow-sub">{sub}</div>}
        </div>
        {right}
      </div>
    );
  }

  function Field({ label, hint, children, stack }) {
    return (
      <div className={'bk-field' + (stack ? ' stack' : '')}>
        <div className="bk-field-l">
          <span className="bk-field-label">{label}</span>
          {hint && <span className="bk-field-hint">{hint}</span>}
        </div>
        <div className="bk-field-ctrl">{children}</div>
      </div>
    );
  }

  function GroupLabel({ children }) { return <div className="bk-grouplabel">{children}</div>; }

  window.BKUI = { TopBar, BottomNav, Toggle, Segmented, Stepper, Slider, ListRow, Field, GroupLabel };
})();
