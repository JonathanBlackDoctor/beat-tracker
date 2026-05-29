// bk-core.jsx — shared clock, drift simulation, zone colors, helpers.
// Exports to window: BK = { useRaf, beatState, simDetected, zoneOf, ZONE, fmtDelta, lerp, clamp }

(function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // Drift zone colors — softened for a calm, low-stimulation dark stage.
  const ZONE = {
    green:  { key: 'green',  c: '#4fd1a5', glow: 'rgba(79,209,165,0.55)', dim: 'rgba(79,209,165,0.16)', label: '일치' },
    yellow: { key: 'yellow', c: '#f4c95f', glow: 'rgba(244,201,95,0.55)', dim: 'rgba(244,201,95,0.16)', label: '주의' },
    red:    { key: 'red',    c: '#f2867f', glow: 'rgba(242,134,127,0.55)', dim: 'rgba(242,134,127,0.16)', label: '벗어남' },
  };

  function zoneOf(absDelta, gThr = 1.5, yThr = 4) {
    if (absDelta <= gThr) return ZONE.green;
    if (absDelta <= yThr) return ZONE.yellow;
    return ZONE.red;
  }

  // Single rAF loop per component. cb receives (seconds, msTimestamp).
  function useRaf(cb, deps = []) {
    const ref = React.useRef(cb);
    ref.current = cb;
    React.useEffect(() => {
      let raf, start = performance.now();
      ref.current(0, start); // synchronous first frame (valid paint even if rAF is paused)
      const loop = (t) => {
        ref.current((t - start) / 1000, t);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(raf);
    }, deps);
  }

  const METER_BEATS = { '4/4': 4, '3/4': 3, '6/8': 2 };

  // Beat phase from a continuous clock. Returns {beat, phase, env, accent}
  //  phase: 0..1 within current beat (0 = downbeat onset)
  //  env:   attack/decay envelope for the visual pulse (1 at onset → 0)
  //  accent: true on beat 1 (and beat with strong accent)
  function beatState(t, bpm, meter = '4/4') {
    const beats = METER_BEATS[meter] || 4;
    const beatDur = 60 / bpm;
    const total = t / beatDur;
    const beat = Math.floor(total) % beats;
    const phase = total - Math.floor(total);
    // soft attack (~8% of beat) then ease-out decay — gentle, not snappy
    const attack = 0.06;
    let env;
    if (phase < attack) env = phase / attack;
    else env = Math.pow(1 - (phase - attack) / (1 - attack), 1.7);
    const accent = beat === 0;
    return { beat, beats, phase, env, accent };
  }

  // Calm wandering detected BPM. Slow compound sine + tiny ripple.
  // seed varies the trajectory per card so a gallery shows different states.
  function simDetected(t, target, seed = 0) {
    const s =
      Math.sin(t * 0.42 + seed) * 2.3 +
      Math.sin(t * 0.15 + seed * 1.7) * 1.5 +
      Math.sin(t * 1.1 + seed * 0.6) * 0.35;
    return target + s;
  }

  // Stability 0..1 (1 = rock steady). Derived as a slow biased sine, inverse-ish
  // to drift magnitude — purely for the demo meter.
  function simStability(t, absDelta, seed = 0) {
    const base = 0.62 + Math.sin(t * 0.33 + seed) * 0.16;
    return clamp(base - absDelta / 18, 0.05, 0.98);
  }

  function fmtDelta(d) {
    const r = Math.round(d);
    if (r === 0) return '±0';
    return (r > 0 ? '+' : '−') + Math.abs(r);
  }

  window.BK = { useRaf, beatState, simDetected, simStability, zoneOf, ZONE, fmtDelta, lerp, clamp, METER_BEATS };
})();
