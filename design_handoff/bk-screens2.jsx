// bk-screens2.jsx — Setlist, SongEditor, Settings screens (확정 디자인 시스템).
// window.SetlistScreen, window.SongEditorScreen, window.SettingsScreen
(function () {
  const { useState, useRef } = React;
  const { TopBar, BottomNav, Toggle, Segmented, Stepper, Slider, ListRow, Field, GroupLabel } = window.BKUI;

  const PlayBtn = ({ on }) => (
    <span className={'bk-rowplay' + (on ? ' on' : '')}>
      <svg viewBox="0 0 24 24" fill="currentColor">{on
        ? <g><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></g>
        : <path d="M8 5l11 7-11 7z" />}</svg>
    </span>
  );

  // ───────────────────────── SETLIST ─────────────────────────
  const SETLISTS = ['토요일 합주', '카페 공연', '연습'];
  const SONGS = [
    { n: '인트로 잼', bpm: 96, m: '4/4' },
    { n: '여름밤', bpm: 120, m: '4/4' },
    { n: '골목길', bpm: 132, m: '4/4' },
    { n: '느린 왈츠', bpm: 84, m: '3/4' },
    { n: '엔딩 - 바다', bpm: 72, m: '6/8' },
  ];
  function SetlistScreen() {
    const [list, setList] = useState(0);
    const [cur, setCur] = useState(1);
    return (
      <div className="bk-screen" data-screen-label="셋리스트">
        <TopBar title="셋리스트"
          right={<button className="bk-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></button>} />
        <div className="bk-chiprow">
          {SETLISTS.map((s, i) => (
            <button key={i} className={'bk-chip' + (i === list ? ' on' : '')} onClick={() => setList(i)}>{s}</button>
          ))}
        </div>
        <div className="bk-scroll">
          <div className="bk-listmeta">{SONGS.length}곡 · 약 24분</div>
          {SONGS.map((s, i) => (
            <ListRow key={i} grip active={i === cur} onClick={() => setCur(i)}
              title={s.n} sub={`${s.bpm} BPM · ${s.m}`}
              right={<PlayBtn on={i === cur} />} />
          ))}
          <button className="bk-addrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>곡 추가</button>
        </div>
        <BottomNav active="셋리스트" />
      </div>
    );
  }

  // ───────────────────────── SONG EDITOR ─────────────────────────
  function SongEditorScreen() {
    const [name, setName] = useState('여름밤');
    const [bpm, setBpm] = useState(120);
    const [meter, setMeter] = useState('4/4');
    const [notes, setNotes] = useState('인트로 후 드럼 인 · 2절은 살짝 푸시');
    const [taps, setTaps] = useState([]);
    const [autoOn, setAutoOn] = useState(false);
    const tapRef = useRef([]);

    const tapTempo = () => {
      const now = performance.now();
      let arr = tapRef.current.filter((t) => now - t < 3000);
      arr.push(now); tapRef.current = arr.slice(-8);
      setTaps(tapRef.current.slice());
      if (tapRef.current.length >= 2) {
        const a = tapRef.current;
        let sum = 0; for (let i = 1; i < a.length; i++) sum += a[i] - a[i - 1];
        const avg = sum / (a.length - 1);
        setBpm(Math.round(60000 / avg));
      }
    };

    const sections = [
      { n: '인트로', bpm: 120, m: '4/4', bars: 8 },
      { n: '벌스', bpm: 120, m: '4/4', bars: 16 },
      { n: '후렴', bpm: 124, m: '4/4', bars: 16 },
    ];

    return (
      <div className="bk-screen" data-screen-label="곡 편집">
        <TopBar title="곡 편집"
          left={<button className="bk-tb-text"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>뒤로</button>}
          right={<button className="bk-tb-text accent">저장</button>} />
        <div className="bk-scroll">
          <div className="bk-field stack">
            <span className="bk-field-label">곡명</span>
            <input className="bk-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="bk-field stack">
            <span className="bk-field-label">목표 BPM</span>
            <div className="bk-bpmset">
              <Stepper value={bpm} onChange={setBpm} min={30} max={280} />
              <div className="bk-bpmways">
                <button className={'bk-waybtn' + (taps.length ? ' live' : '')} onClick={tapTempo}>
                  탭 템포{taps.length >= 2 ? ` · ${taps.length}` : ''}
                </button>
                <button className={'bk-waybtn' + (autoOn ? ' on' : '')} onClick={() => setAutoOn((v) => !v)}>
                  {autoOn ? '듣는 중…' : '자동 인식'}
                </button>
              </div>
            </div>
          </div>

          <Field label="박자표">
            <Segmented options={[['4/4', '4/4'], ['3/4', '3/4'], ['6/8', '6/8']]} value={meter} onChange={setMeter} />
          </Field>

          <div className="bk-field stack">
            <span className="bk-field-label">메모 / 큐</span>
            <textarea className="bk-input bk-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}></textarea>
          </div>

          <GroupLabel>구간 (섹션)</GroupLabel>
          {sections.map((s, i) => (
            <ListRow key={i} grip title={s.n} sub={`${s.bpm} BPM · ${s.m} · ${s.bars}마디`}
              right={<span className="bk-chev">›</span>} />
          ))}
          <button className="bk-addrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>구간 추가</button>
        </div>
      </div>
    );
  }

  // ───────────────────────── SETTINGS ─────────────────────────
  function SettingsScreen() {
    const [sound, setSound] = useState('wood');
    const [vol, setVol] = useState(70);
    const [accent, setAccent] = useState(true);
    const [countIn, setCountIn] = useState('1');
    const [subdiv, setSubdiv] = useState('off');
    const [green, setGreen] = useState(1.5);
    const [yellow, setYellow] = useState(4);
    const [vib, setVib] = useState(false);
    const [measMode, setMeasMode] = useState('always');
    const [keepOn, setKeepOn] = useState(true);

    return (
      <div className="bk-screen" data-screen-label="설정">
        <TopBar title="설정" />
        <div className="bk-scroll">
          <GroupLabel>메트로놈</GroupLabel>
          <Field label="클릭음">
            <Segmented full options={[['wood', '우드'], ['beep', '비프'], ['hat', '하이햇'], ['rim', '림']]} value={sound} onChange={setSound} />
          </Field>
          <Field label="클릭 볼륨" hint={vol + '%'}>
            <Slider value={vol} onChange={setVol} />
          </Field>
          <Field label="1박 강세"><Toggle on={accent} onChange={setAccent} /></Field>
          <Field label="카운트인">
            <Segmented options={[['off', '끔'], ['1', '1마디'], ['2', '2마디']]} value={countIn} onChange={setCountIn} />
          </Field>
          <Field label="잘게 쪼개기">
            <Segmented options={[['off', '끔'], ['8', '8분'], ['16', '16분']]} value={subdiv} onChange={setSubdiv} />
          </Field>

          <GroupLabel>드리프트 색 임계값</GroupLabel>
          <Field label={<span><span className="bk-dot green"></span>초록 (일치)</span>} hint={'±' + green.toFixed(1) + ' BPM'}>
            <Slider value={green} onChange={setGreen} min={0.5} max={3} step={0.5} />
          </Field>
          <Field label={<span><span className="bk-dot yellow"></span>노랑 (주의)</span>} hint={'±' + yellow + ' BPM'}>
            <Slider value={yellow} onChange={setYellow} min={3} max={8} step={0.5} />
          </Field>

          <GroupLabel>일반</GroupLabel>
          <Field label="진동 피드백"><Toggle on={vib} onChange={setVib} /></Field>
          <Field label="측정 기본 모드">
            <Segmented options={[['always', '항상'], ['tap', '탭']]} value={measMode} onChange={setMeasMode} />
          </Field>
          <Field label="화면 항상 켜둠"><Toggle on={keepOn} onChange={setKeepOn} /></Field>
          <Field label="언어"><span className="bk-field-static">한국어 ›</span></Field>
        </div>
        <BottomNav active="설정" />
      </div>
    );
  }

  window.SetlistScreen = SetlistScreen;
  window.SongEditorScreen = SongEditorScreen;
  window.SettingsScreen = SettingsScreen;
})();
