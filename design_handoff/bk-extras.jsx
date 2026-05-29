// bk-extras.jsx — state-variation cards, wordmarks, app icons.
// window.StateCard, window.Wordmark, window.AppIcon
(function () {
  const { useRef, useEffect } = React;
  const { fmtDelta, clamp, ZONE } = window.BK;
  const { useInstrument, setupCanvas, clear } = window.BKI;

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // Compact concentric ring used for the state gallery.
  function MiniRing({ status, force, target = 120, label, desc }) {
    const cv = useRef(), ctxR = useRef(), sm = useRef(force ? force.delta || 0 : 0);
    const bpmR = useRef();
    const W = 196, H = 196;
    useEffect(() => { ctxR.current = setupCanvas(cv.current, W, H); }, []);
    useInstrument({ target, meter: '4/4', seed: 0, status, force }, (st) => {
      const ctx = ctxR.current; if (!ctx) return;
      clear(ctx, W, H);
      const cx = W / 2, cy = 86, R = 66, live = st.detected != null;
      sm.current += ((force ? (force.delta || 0) : st.delta) - sm.current) * 0.1;
      const env = st.muted ? 0 : st.env, z = st.zone;
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      const measuring = status === 'measuring';
      if (measuring) {
        // sweeping arc while measuring
        const a = st.t * 2.2;
        ctx.strokeStyle = 'rgba(56,189,248,0.8)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx, cy, R, a, a + 1.2); ctx.stroke();
      } else {
        const rr = R * (1 + 0.05 * env * (st.accent ? 1.3 : 1));
        ctx.save();
        ctx.shadowColor = z.glow; ctx.shadowBlur = live ? 6 + 18 * env : 0;
        ctx.strokeStyle = live ? z.c : 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 4 + 4 * env; ctx.globalAlpha = live ? 0.55 + 0.45 * env : 0.5;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        if (live) {
          const mx = cx + clamp(sm.current / 8, -1, 1) * 44;
          ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(cx - 50, 150); ctx.lineTo(cx + 50, 150); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.beginPath(); ctx.moveTo(cx, 144); ctx.lineTo(cx, 156); ctx.stroke();
          ctx.save(); ctx.shadowColor = z.glow; ctx.shadowBlur = 10; ctx.fillStyle = z.c;
          ctx.beginPath(); ctx.arc(clamp(cx + sm.current / 8 * 50, cx - 50, cx + 50), 150, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
      }
      if (status === 'permission') {
        // muted mic glyph hint handled by label
      }
      if (bpmR.current) bpmR.current.textContent = live ? Math.round(st.detected) : '– –';
    });
    return (
      <div className="bk-statecard">
        <div className="bk-mini">
          <canvas ref={cv}></canvas>
          <div className="bk-mini-num"><span ref={bpmR}>– –</span></div>
        </div>
        <div className="bk-statelabel" style={{ color: force && force.zone ? ZONE[force.zone].c : '#e9eaee' }}>{label}</div>
        <div className="bk-statedesc">{desc}</div>
      </div>
    );
  }

  // ───── App icon tile ─────
  function AppIcon({ kind = 'ring', label, maskable }) {
    const cv = useRef();
    const S = 132;
    useEffect(() => {
      const ctx = setupCanvas(cv.current, S, S); let raf, start = performance.now();
      const loop = (t) => {
        const s = (t - start) / 1000, phase = s % 1, env = Math.pow(1 - phase, 1.8);
        clear(ctx, S, S);
        const cx = S / 2, cy = S / 2, glow = '#38bdf8';
        if (kind === 'ring') {
          ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(cx, cy, 40, 0, Math.PI * 2); ctx.stroke();
          ctx.save(); ctx.shadowColor = glow; ctx.shadowBlur = 10 + 24 * env;
          ctx.strokeStyle = glow; ctx.lineWidth = 5 + 3 * env; ctx.globalAlpha = 0.7 + 0.3 * env;
          ctx.beginPath(); ctx.arc(cx, cy, 40 * (1 + 0.06 * env), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
          ctx.save(); ctx.shadowColor = glow; ctx.shadowBlur = 8 + 16 * env; ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(cx, cy, 9 + 5 * env, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        } else if (kind === 'dot') {
          for (let i = 0; i < 3; i++) {
            const rr = 18 + i * 16, a = clamp(env - i * 0.18, 0, 1);
            ctx.strokeStyle = hexA(glow, 0.5 * a + 0.05); ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.save(); ctx.shadowColor = glow; ctx.shadowBlur = 10 + 20 * env; ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(cx, cy, 11 + 5 * env, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        } else { // ticks
          const N = 24;
          for (let i = 0; i < N; i++) {
            const ang = (i / N) * Math.PI * 2 - Math.PI / 2;
            const top = Math.abs(((ang + Math.PI / 2 + Math.PI) % (Math.PI * 2)) - Math.PI) < 0.9;
            ctx.strokeStyle = top ? hexA(glow, 0.6 + 0.4 * env) : 'rgba(255,255,255,0.14)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(ang) * 34, cy + Math.sin(ang) * 34);
            ctx.lineTo(cx + Math.cos(ang) * 46, cy + Math.sin(ang) * 46);
            ctx.stroke();
          }
          ctx.save(); ctx.shadowColor = glow; ctx.shadowBlur = 10 + 16 * env; ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(cx, cy, 8 + 4 * env, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
        raf = requestAnimationFrame(loop);
      };
      loop(start);
      return () => cancelAnimationFrame(raf);
    }, []);
    return (
      <div className="bk-iconwrap">
        <div className={'bk-icontile' + (maskable ? ' mask' : '')}><canvas ref={cv}></canvas></div>
        <div className="bk-iconlbl">{label}</div>
      </div>
    );
  }

  window.StateCard = MiniRing;
  window.AppIcon = AppIcon;
})();
