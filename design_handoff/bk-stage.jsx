// bk-stage.jsx — large concentric ring for 공연 모드 + landscape.
// window.StageRing, window.StagePerform, window.LandView
(function () {
  const { useRef, useEffect, useState } = React;
  const { fmtDelta, clamp } = window.BK;
  const { useInstrument, setupCanvas, clear } = window.BKI;
  const { needleTrack, beatDots } = window.BKD;

  const num = (d) => (d == null ? '– –' : String(Math.round(d)));

  // Parametric concentric ring; draws ring (+optional needle/dots), reports state up.
  function StageRing(props) {
    const { w, h, cx, cy, R, target, meter = '4/4', seed = 0, status = 'live',
      needleY = null, needleHalf = null, dotsY = null, dotGap = 30, onState } = props;
    const cv = useRef(), ctxR = useRef(), sm = useRef(0);
    useEffect(() => { ctxR.current = setupCanvas(cv.current, w, h); }, [w, h]);
    useInstrument({ target, meter, seed, status }, (st) => {
      const ctx = ctxR.current; if (!ctx) return;
      clear(ctx, w, h);
      const live = st.detected != null;
      sm.current += (st.delta - sm.current) * 0.08;
      const env = st.muted ? 0 : st.env, z = st.zone;
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      const rr = R * (1 + 0.05 * env * (st.accent ? 1.3 : 1));
      ctx.save();
      ctx.shadowColor = z.glow; ctx.shadowBlur = live ? 12 + 38 * env : 0;
      ctx.strokeStyle = live ? z.c : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 5 + 7 * env; ctx.globalAlpha = live ? 0.5 + 0.5 * env : 0.5;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      if (needleY != null) needleTrack(ctx, { cx, y: needleY, halfW: needleHalf || R, pos: sm.current, zone: z, live });
      if (dotsY != null) beatDots(ctx, { cx, y: dotsY, beats: st.beats, beat: st.beat, env, gap: dotGap, r: 5 });
      onState && onState(st);
    });
    return <canvas ref={cv}></canvas>;
  }

  // shared transient-controls reveal hook for 공연 모드
  function useReveal() {
    const [shown, setShown] = useState(false);
    const tR = useRef();
    const flash = () => {
      setShown(true);
      clearTimeout(tR.current);
      tR.current = setTimeout(() => setShown(false), 3200);
    };
    useEffect(() => () => clearTimeout(tR.current), []);
    return [shown, flash, () => setShown(false)];
  }

  // ── 공연 모드 (세로 전체화면) ──
  function StagePerform({ target = 120, meter = '4/4', seed = 0.3, onExit }) {
    const bpmR = useRef(), subR = useRef(), stabR = useRef(), zoneR = useRef();
    const [shown, flash] = useReveal();
    const W = 384, H = 812;
    const onState = (st) => {
      const live = st.detected != null;
      if (bpmR.current) bpmR.current.textContent = num(st.detected);
      if (subR.current) subR.current.textContent = live ? `목표 ${st.target}  ·  Δ ${fmtDelta(st.delta)}` : `목표 ${st.target}`;
      if (zoneR.current) zoneR.current.style.color = live ? st.zone.c : 'var(--text2)';
      if (stabR.current) stabR.current.style.width = (live ? st.stab * 100 : 0) + '%';
    };
    return (
      <div className="bk-stage" onClick={flash} data-screen-label="공연 모드 · 세로">
        <StageRing w={W} h={H} cx={W / 2} cy={300} R={152} target={target} meter={meter} seed={seed}
          needleY={500} needleHalf={150} dotsY={556} dotGap={34} onState={onState} />
        <div className="bk-stage-num">
          <span ref={bpmR}>– –</span><i>BPM</i>
        </div>
        <div className="bk-stage-sub" ref={subR}>목표 {target}</div>
        <div className="bk-stage-stab"><div className="bk-stabfill" ref={stabR}></div></div>
        <div className="bk-stage-hint">공연 모드 · 화면을 탭하면 컨트롤</div>

        <div className={'bk-stage-bar' + (shown ? ' show' : '')} onClick={(e) => e.stopPropagation()}>
          <button className="bk-sb">‹</button>
          <button className="bk-sb wide"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>정지</button>
          <button className="bk-sb">›</button>
          <button className="bk-sb exit" onClick={onExit}>공연 종료</button>
        </div>
        <span ref={zoneR} style={{ display: 'none' }}></span>
      </div>
    );
  }

  // ── 가로 레이아웃 (perform=false 일반 / true 공연) — BPM은 링 안쪽 중앙 ──
  function LandView({ target = 120, meter = '4/4', seed = 0.3, perform = false, brand = '비트키퍼' }) {
    const bpmR = useRef(), subR = useRef(), stabR = useRef();
    const [shown, flash] = useReveal();
    const W = 812, H = 384;
    const onState = (st) => {
      const live = st.detected != null;
      if (bpmR.current) bpmR.current.textContent = num(st.detected);
      if (subR.current) {
        subR.current.textContent = live ? `목표 ${st.target} · Δ ${fmtDelta(st.delta)}` : `목표 ${st.target}`;
        subR.current.style.color = live ? st.zone.c : 'var(--text2)';
      }
      if (stabR.current) stabR.current.style.width = (live ? st.stab * 100 : 0) + '%';
    };
    const ringW = perform ? 520 : 440;
    const ringCx = ringW / 2, ringR = perform ? 150 : 126;
    const ringCy = H / 2 - 30;
    return (
      <div className={'bk-land' + (perform ? ' perform' : '')} onClick={perform ? flash : undefined}
        data-screen-label={'가로 · ' + (perform ? '공연' : '일반')}>
        <div className="bk-land-l" style={{ width: ringW }}>
          <StageRing w={ringW} h={H} cx={ringCx} cy={ringCy} R={ringR}
            target={target} meter={meter} seed={seed}
            needleY={ringCy + ringR + 26} needleHalf={ringR} dotsY={ringCy + ringR + 56} dotGap={30} onState={onState} />
          <div className={'bk-land-num' + (perform ? ' big' : '')} style={{ left: ringCx, top: ringCy }}>
            <div className="bk-num"><span ref={bpmR}>– –</span><i>BPM</i></div>
            <div className="bk-sub" ref={subR}>목표 {target}</div>
          </div>
        </div>
        <div className="bk-land-r">
          {!perform && <div className="bk-land-brand">{brand}<span>BEATKEEPER</span></div>}
          <div className="bk-stabwrap" style={{ position: 'static', transform: 'none', width: '100%' }}>
            <span className="bk-stablbl">안정도</span>
            <div className="bk-stabtrack"><div className="bk-stabfill" ref={stabR}></div></div>
          </div>
          {!perform && (
            <div className="bk-land-ctrl">
              <button className="bk-tbtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>마이크</button>
              <button className="bk-play"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>정지</button>
              <button className="bk-tbtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" /></svg>공연</button>
            </div>
          )}
          {perform && <div className="bk-stage-hint" style={{ position: 'static', marginTop: 16 }}>공연 모드 · 화면을 탭하면 컨트롤</div>}
        </div>
      </div>
    );
  }

  window.StageRing = StageRing;
  window.StagePerform = StagePerform;
  window.LandView = LandView;
})();
