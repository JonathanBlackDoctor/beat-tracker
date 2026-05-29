// bk-screen.jsx — performance screen shell (header + instrument + controls + nav).
// window.PerformanceScreen
(function () {
  const { useState } = React;

  const ICON = {
    expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  };

  function Seg({ value, onChange }) {
    return (
      <div className="bk-seg" role="tablist">
        {[['always', '항상 측정'], ['tap', '탭 측정']].map(([k, l]) => (
          <button key={k} className={'bk-seg-b' + (value === k ? ' on' : '')} onClick={() => onChange(k)}>{l}</button>
        ))}
      </div>
    );
  }

  function PerformanceScreen(props) {
    const { variant = 'concentric', target = 120, meter = '4/4', seed = 0, song = '예시 곡',
      brand = '비트키퍼', brandLatin = 'BEATKEEPER' } = props;
    const [status, setStatus] = useState(props.status || 'live');
    const [playing, setPlaying] = useState(props.playing ?? true);
    const [mode, setMode] = useState('always'); // always | tap
    const [free, setFree] = useState(false);
    const [perform, setPerform] = useState(false);

    if (perform) {
      return <window.StagePerform target={target} meter={meter} seed={seed} onExit={() => setPerform(false)} />;
    }

    const Inst = window.BKInst[variant] || window.BKInst.concentric;
    const live = status === 'live';

    const statusMsg =
      status === 'permission' ? '마이크 권한 필요 — 마이크 버튼을 누르세요' :
      status === 'measuring' ? '측정 중…' :
      status === 'nosignal' ? '신호 없음 · 박자 불명확' : null;

    return (
      <div className="bk-screen" data-screen-label={'연주 · ' + variant}>
        {/* header */}
        <div className="bk-top">
          <div className="bk-brand">{brand}<span>{brandLatin}</span></div>
          <button className="bk-icon" title="공연 모드">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICON.expand} /></svg>
          </button>
        </div>

        <div className={'bk-statusline ' + (statusMsg ? 'warn' : '')}>
          {statusMsg || <span className="bk-songmini">{song} · {target} BPM · {meter}</span>}
        </div>

        {/* live instrument */}
        <Inst variant={variant} target={target} meter={meter} seed={seed}
          status={status} force={free && live ? null : (props.force || null)} />

        {/* controls */}
        <div className="bk-controls">
          <div className="bk-row">
            <Seg value={mode} onChange={setMode} />
            <button className={'bk-pill' + (free ? ' on' : '')} onClick={() => setFree(f => !f)}>프리</button>
          </div>

          <div className="bk-songnav">
            <button className="bk-nav-arrow" aria-label="이전 곡">‹</button>
            <div className="bk-songinfo">
              <div className="bk-songname">{song}</div>
              <div className="bk-songmeta">{target} BPM · {meter}</div>
            </div>
            <button className="bk-nav-arrow" aria-label="다음 곡">›</button>
          </div>

          <div className="bk-row bk-transport">
            <button className={'bk-tbtn' + (live ? ' active' : '')}
              onClick={() => setStatus(s => (s === 'live' ? 'permission' : 'live'))}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              마이크
            </button>
            <button className={'bk-play' + (playing ? ' on' : '')} onClick={() => setPlaying(p => !p)}>
              {playing
                ? <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                : <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z" /></svg>}
              {playing ? '정지' : '재생'}
            </button>
            <button className="bk-tbtn" onClick={() => setPerform(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" /></svg>
              공연
            </button>
          </div>
        </div>

        {/* bottom nav */}
        <nav className="bk-tabs">
          {[
            ['연주', true, 'M7 4l13 8-13 8z'],
            ['셋리스트', false, 'M4 6h16M4 12h16M4 18h10'],
            ['기록', false, 'M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-7'],
            ['설정', false, 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l1.5 1-1 2-1.8-.4-1.3 1.3.4 1.8-2 1-1-1.5h-2l-1 1.5-2-1 .4-1.8L4.6 15 2.8 15.4l-1-2L3.3 12 1.8 11l1-2 1.8.4 1.3-1.3L5.5 6.3l2-1 1 1.5h2l1-1.5 2 1-.4 1.8 1.3 1.3 1.8-.4 1 2L19 12z'],
          ].map(([l, on, d], i) => (
            <button key={i} className={'bk-tab' + (on ? ' on' : '')}>
              <svg viewBox="0 0 24 24" fill={i === 0 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d={d} /></svg>
              <span>{l}</span>
            </button>
          ))}
        </nav>
      </div>
    );
  }

  window.PerformanceScreen = PerformanceScreen;
})();
