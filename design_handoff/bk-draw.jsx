// bk-draw.jsx — shared canvas drawing primitives. window.BKD

(function () {
  const { clamp, lerp } = window.BK;

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Horizontal drift needle. left = slow (behind), right = fast (ahead).
  // pos is the *smoothed* delta the caller maintains for calm motion.
  function needleTrack(ctx, o) {
    const { cx, y, halfW, pos, zone, full = 8, faint = 'rgba(255,255,255,0.12)', live = true } = o;
    // baseline
    ctx.strokeStyle = faint;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - halfW, y);
    ctx.lineTo(cx + halfW, y);
    ctx.stroke();
    // end + center ticks
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    [-halfW, halfW].forEach((dx) => {
      ctx.beginPath(); ctx.moveTo(cx + dx, y - 6); ctx.lineTo(cx + dx, y + 6); ctx.stroke();
    });
    // center target tick (taller, accent)
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, y - 11); ctx.lineTo(cx, y + 11); ctx.stroke();
    if (!live) return;
    // moving marker
    const mx = cx + clamp(pos / full, -1, 1) * halfW;
    ctx.save();
    ctx.shadowColor = zone.glow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = zone.c;
    ctx.beginPath();
    ctx.arc(mx, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // connecting segment from center to marker (shows direction)
    ctx.strokeStyle = zone.c;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(mx, y); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Row of beat dots; current beat lit, beat 1 = accent ring.
  function beatDots(ctx, o) {
    const { cx, y, beats, beat, env, gap = 26, r = 4.5, color = '#e9eaee' } = o;
    const totalW = (beats - 1) * gap;
    for (let i = 0; i < beats; i++) {
      const x = cx - totalW / 2 + i * gap;
      const active = i === beat;
      const isAccent = i === 0;
      ctx.beginPath();
      ctx.arc(x, y, isAccent ? r + 1.5 : r, 0, Math.PI * 2);
      if (active) {
        ctx.save();
        ctx.shadowColor = 'rgba(233,234,238,0.5)';
        ctx.shadowBlur = 10 * (0.4 + 0.6 * (env || 0));
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.6 + 0.4 * (env || 0);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fill();
      }
      if (isAccent && !active) {
        ctx.strokeStyle = 'rgba(255,255,255,0.34)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  window.BKD = { roundRect, needleTrack, beatDots };
})();
