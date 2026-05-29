// bk-inst-a.jsx — performance-screen instrument: Concentric ring (확정안).
// window.BKInst.concentric
(function () {
  const { useRef, useEffect } = React;
  const { fmtDelta } = window.BK;
  const { useInstrument, setupCanvas, clear } = window.BKI;
  const { needleTrack, beatDots } = window.BKD;

  const setTxt = (ref, t) => { if (ref.current && ref.current.textContent !== t) ref.current.textContent = t; };
  const num = (d) => (d == null ? '– –' : String(Math.round(d)));

  function Concentric(props) {
    const cv = useRef(), ctxR = useRef(), sm = useRef(0);
    const bpmR = useRef(), subR = useRef(), stabR = useRef();
    const W = 384, H = 452;
    useEffect(() => { ctxR.current = setupCanvas(cv.current, W, H); }, []);
    useInstrument(props, (st) => {
      const ctx = ctxR.current; if (!ctx) return;
      clear(ctx, W, H);
      const cx = W / 2, cy = 150, R = 116, live = st.detected != null;
      sm.current += (st.delta - sm.current) * 0.08;
      const env = st.muted ? 0 : st.env, z = st.zone;
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      const rr = R * (1 + 0.05 * env * (st.accent ? 1.3 : 1));
      ctx.save();
      ctx.shadowColor = z.glow; ctx.shadowBlur = live ? 8 + 26 * env : 0;
      ctx.strokeStyle = live ? z.c : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 4 + 5 * env;
      ctx.globalAlpha = live ? 0.5 + 0.5 * env : 0.5;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      needleTrack(ctx, { cx, y: 300, halfW: 140, pos: sm.current, zone: z, live });
      beatDots(ctx, { cx, y: 346, beats: st.beats, beat: st.beat, env });
      setTxt(bpmR, num(st.detected));
      setTxt(subR, live ? `목표 ${st.target} · Δ ${fmtDelta(st.delta)}` : `목표 ${st.target}`);
      if (stabR.current) stabR.current.style.width = (live ? st.stab * 100 : 0) + '%';
    });
    return (
      <div className="bk-inst">
        <canvas ref={cv}></canvas>
        <div className="bk-center" style={{ top: 150 }}>
          <div className="bk-num"><span ref={bpmR}>– –</span><i>BPM</i></div>
          <div className="bk-sub" ref={subR}>목표 {props.target}</div>
        </div>
        <div className="bk-stabwrap" style={{ top: 392 }}>
          <span className="bk-stablbl">안정도</span>
          <div className="bk-stabtrack"><div className="bk-stabfill" ref={stabR}></div></div>
        </div>
      </div>
    );
  }

  window.BKInst = Object.assign(window.BKInst || {}, { concentric: Concentric });
})();
