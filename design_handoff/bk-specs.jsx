// bk-specs.jsx — design-system docs: AnimSpec, TokenSheet, ComponentSheet.
// window.AnimSpec, window.TokenSheet, window.ComponentSheet
(function () {
  const { useState, useRef, useEffect } = React;
  const { setupCanvas, clear } = window.BKI;
  const { Toggle, Segmented, Stepper, Slider, ListRow } = window.BKUI;

  // ── live demo ring (green, beating @120) ──
  function AnimRingDemo({ size = 180, bpm = 120 }) {
    const cv = useRef();
    useEffect(() => {
      const ctx = setupCanvas(cv.current, size, size); let raf, start = performance.now();
      const loop = (t) => {
        const s = (t - start) / 1000, beatDur = 60 / bpm, ph = (s / beatDur) % 1;
        const attack = 0.06; let env = ph < attack ? ph / attack : Math.pow(1 - (ph - attack) / (1 - attack), 1.7);
        clear(ctx, size, size);
        const cx = size / 2, cy = size / 2, R = size * 0.36, g = '#4fd1a5';
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.save(); ctx.shadowColor = 'rgba(79,209,165,0.55)'; ctx.shadowBlur = 8 + 26 * env;
        ctx.strokeStyle = g; ctx.lineWidth = 4 + 5 * env; ctx.globalAlpha = 0.5 + 0.5 * env;
        ctx.beginPath(); ctx.arc(cx, cy, R * (1 + 0.05 * env), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        raf = requestAnimationFrame(loop);
      };
      loop(start); return () => cancelAnimationFrame(raf);
    }, []);
    return <canvas ref={cv}></canvas>;
  }

  // ── envelope curve graph over one beat ──
  function EnvGraph({ w = 300, h = 130 }) {
    const cv = useRef();
    useEffect(() => {
      const ctx = setupCanvas(cv.current, w, h);
      clear(ctx, w, h);
      const padL = 8, padR = 8, padT = 12, padB = 22;
      const x0 = padL, x1 = w - padR, y0 = h - padB, y1 = padT;
      // axes
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
      // curve
      const attack = 0.06;
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const ph = i / 100;
        const env = ph < attack ? ph / attack : Math.pow(1 - (ph - attack) / (1 - attack), 1.7);
        const x = x0 + (x1 - x0) * ph, y = y0 - (y0 - y1) * env;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2.5; ctx.stroke();
      // onset marker
      ctx.fillStyle = '#4fd1a5'; ctx.save(); ctx.shadowColor = 'rgba(79,209,165,.6)'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * attack, y1, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px "IBM Plex Mono"';
      ctx.fillText('온셋', x0 + 2, y1 + 2); ctx.textAlign = 'right'; ctx.fillText('다음 박', x1, y0 + 15);
    }, []);
    return <canvas ref={cv}></canvas>;
  }

  function AnimSpec() {
    const rows = [
      ['주기 (period)', '60000 / BPM ms', '120 BPM → 500ms'],
      ['어택 (attack)', '주기의 6%', '≈ 30ms · 선형 상승'],
      ['감쇠 (decay)', 'ease-out  (1−p)^1.7', '나머지 94% 구간'],
      ['크기 변화', '+5% (일반) / +6.5% (1박)', 'scale on 반경'],
      ['글로우 blur', '8 → 34 px', 'shadowBlur, env 비례'],
      ['선 두께', '4 → 9 px', 'env 비례'],
      ['바늘 이징', 'EMA  α = 0.08 / frame', '떨림 억제, 부드럽게'],
      ['색 전환', '즉시 (존 경계)', '초록≤1.5 · 노랑≤4 · 빨강>4'],
      ['동기', '오디오 클릭과 동일 타임스탬프', '시각=청각 일치'],
    ];
    return (
      <div className="bk-doc">
        <div className="bk-doc-row">
          <div className="bk-doc-demo">
            <AnimRingDemo size={184} />
            <div className="bk-doc-cap">실시간 데모 · 120 BPM · 초록(일치)</div>
          </div>
          <div className="bk-doc-graph">
            <div className="bk-doc-h">박동 엔벨로프 (1박)</div>
            <EnvGraph w={300} h={130} />
            <div className="bk-doc-cap">빠른 어택 → 부드러운 이즈아웃 감쇠. 저자극·차분한 호흡.</div>
          </div>
        </div>
        <table className="bk-spectable">
          <thead><tr><th>항목</th><th>값</th><th>비고</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td>{r[0]}</td><td className="mono">{r[1]}</td><td className="dim">{r[2]}</td></tr>)}</tbody>
        </table>
      </div>
    );
  }

  // ── tokens ──
  const COLORS = [
    ['배경', '--bg', '#0a0b0e'], ['배경 2', '--bg2', '#0e1016'],
    ['표면', '--surface', '#15171e'], ['표면 2', '--surface2', '#1c1f28'],
    ['경계', '--border', '#282b35'],
    ['텍스트', '--text', '#e9eaee'], ['보조', '--text2', '#9aa0aa'], ['흐림', '--dim', '#6b7280'],
    ['강조 cyan', '--accent', '#38bdf8'],
    ['초록 일치', '', '#4fd1a5'], ['노랑 주의', '', '#f4c95f'], ['빨강 벗어남', '', '#f2867f'],
  ];
  const TYPE = [
    ['공연 숫자', 'IBM Plex Mono', '94 / 600'],
    ['BPM 숫자', 'IBM Plex Mono', '62 / 600'],
    ['타이틀', 'Noto Sans KR', '22 / 900'],
    ['본문', 'Noto Sans KR', '15 / 700'],
    ['보조', 'IBM Plex Mono', '14 / 500'],
    ['캡션', 'Noto Sans KR', '12 / 600'],
  ];
  function TokenSheet() {
    return (
      <div className="bk-doc">
        <div className="bk-doc-h">색상</div>
        <div className="bk-swatches">
          {COLORS.map((c, i) => (
            <div key={i} className="bk-swatch">
              <div className="bk-swatch-chip" style={{ background: c[2] }}></div>
              <div className="bk-swatch-name">{c[0]}</div>
              <div className="bk-swatch-hex">{c[2]}</div>
            </div>
          ))}
        </div>
        <div className="bk-doc-h" style={{ marginTop: 22 }}>타이포 · 간격</div>
        <div className="bk-typegrid">
          {TYPE.map((t, i) => (
            <div key={i} className="bk-typerow">
              <span className="bk-type-eg" style={{ fontFamily: t[1].includes('Mono') ? "'IBM Plex Mono'" : "'Noto Sans KR'", fontSize: Math.min(30, parseInt(t[2]) / 2.2) }}>Aa 120</span>
              <span className="bk-type-name">{t[0]}</span>
              <span className="bk-type-spec mono">{t[1]} · {t[2]}</span>
            </div>
          ))}
          <div className="bk-tokmeta">모서리 <b>14px</b> · 최소 탭 타깃 <b>52px</b> · 기본 간격 <b>10–16px</b></div>
        </div>
      </div>
    );
  }

  // ── components gallery ──
  function ComponentSheet() {
    const [seg, setSeg] = useState('always');
    const [tog, setTog] = useState(true);
    const [sl, setSl] = useState(60);
    const [num, setNum] = useState(120);
    return (
      <div className="bk-doc bk-comp">
        <div className="bk-comp-col">
          <div className="bk-comp-h">버튼</div>
          <div className="bk-comp-rowwrap">
            <button className="bk-play" style={{ flex: 'none', minWidth: 120 }}><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z" /></svg>재생</button>
            <button className="bk-pill on">프리</button>
            <button className="bk-pill">곡</button>
          </div>
          <div className="bk-comp-h">세그먼트 · 토글</div>
          <Segmented options={[['always', '항상 측정'], ['tap', '탭 측정']]} value={seg} onChange={setSeg} />
          <div className="bk-comp-rowwrap"><Toggle on={tog} onChange={setTog} /><Stepper value={num} onChange={setNum} /></div>
          <div className="bk-comp-h">슬라이더</div>
          <Slider value={sl} onChange={setSl} />
        </div>
        <div className="bk-comp-col">
          <div className="bk-comp-h">리스트 행</div>
          <ListRow grip title="여름밤" sub="120 BPM · 4/4" right={<span className="bk-rowplay on"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg></span>} active />
          <ListRow grip title="골목길" sub="132 BPM · 4/4" right={<span className="bk-rowplay"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5l11 7-11 7z" /></svg></span>} />
          <div className="bk-comp-h">안정도 · 박자 점</div>
          <div className="bk-stabwrap" style={{ position: 'static', transform: 'none', width: '100%' }}>
            <span className="bk-stablbl">안정도</span>
            <div className="bk-stabtrack"><div className="bk-stabfill" style={{ width: '68%' }}></div></div>
          </div>
          <div className="bk-dotsdemo">
            <span className="bk-bd accent on"></span><span className="bk-bd"></span><span className="bk-bd"></span><span className="bk-bd"></span>
          </div>
        </div>
      </div>
    );
  }

  window.AnimSpec = AnimSpec;
  window.TokenSheet = TokenSheet;
  window.ComponentSheet = ComponentSheet;
})();
