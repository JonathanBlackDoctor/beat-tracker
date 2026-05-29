// bk-inst-core.jsx — instrument state hook + canvas helpers.
// Exports: window.BKI = { useInstrument, setupCanvas, clear, ringGlow, easeOutCubic }

(function () {
  const { useRaf, beatState, simDetected, simStability, zoneOf, ZONE } = window.BK;

  // Derives live instrument state each frame and hands it to onFrame(st).
  // Components update their own canvas + DOM refs inside onFrame (no setState).
  function useInstrument({ target, meter = '4/4', seed = 0, status = 'live', force = null }, onFrame) {
    const stRef = React.useRef({});
    const fn = React.useRef(onFrame);
    fn.current = onFrame;
    useRaf((t) => {
      let detected = null, delta = 0, zone = ZONE.green, stab = 0;
      if (force) {
        detected = force.detected ?? null;
        delta = force.delta ?? 0;
        zone = force.zone ? ZONE[force.zone] : (detected != null ? zoneOf(Math.abs(delta)) : ZONE.green);
        stab = force.stability ?? 0.7;
        if (status === 'measuring' || status === 'nosignal' || status === 'permission') detected = null;
      } else if (status === 'live') {
        detected = simDetected(t, target, seed);
        delta = detected - target;
        zone = zoneOf(Math.abs(delta));
        stab = simStability(t, Math.abs(delta), seed);
      }
      const bs = beatState(t, target, meter);
      // metronome keeps ticking visually unless we have no clock context
      const muted = status === 'permission';
      const st = { t, detected, delta, zone, stab, target, meter, status, muted, ...bs };
      stRef.current = st;
      fn.current(st);
    }, [target, meter, seed, status, JSON.stringify(force)]);
    return stRef;
  }

  function setupCanvas(canvas, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function clear(ctx, w, h) { ctx.clearRect(0, 0, w, h); }

  const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

  window.BKI = { useInstrument, setupCanvas, clear, easeOutCubic };
})();
