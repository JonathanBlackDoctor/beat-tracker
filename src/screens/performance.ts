// 비트키퍼 — 연주 화면 (브리프 §4.1) : 기본 진입점
import { engine } from '../audio/audioEngine.ts';
import { store } from '../state/store.ts';
import { uid } from '../state/store.ts';
import { PulseRing } from '../render/pulseRing.ts';
import { wakeLock } from '../pwa.ts';
import { el, toast } from '../ui.ts';
import type { AppCtx, ScreenController } from '../ui.ts';
import type { Meter, Song, Session, SessionSample } from '../types.ts';
import { mainBeatsPerBar } from '../types.ts';

interface Active {
  bpm: number;
  meter: Meter;
  sectionName: string | null;
  sectionCount: number;
  idx: number;
}

export function createPerformanceScreen(_app: AppCtx): ScreenController {
  let currentSongId: string | null = null;
  let sectionIndex = 0;
  let freeMode = false;
  let measureMode: 'always' | 'tap' = store.settings.defaultMeasureMode;
  let ring: PulseRing | null = null;
  let refreshTimer: number | null = null;
  let logAccum = 0;

  // Phase 3 세션 로깅
  let session: (Session & { _t0: number }) | null = null;

  // --- DOM ---
  const canvas = el('canvas') as HTMLCanvasElement;
  const statusEl = el('div', { class: 'perf__status' });
  const fsBtn = el('button', { class: 'btn btn--ghost iconbtn fs-toggle', title: '공연 모드', onClick: toggleFullscreen }, '⛶');
  const fsHint = el('div', { class: 'fs-hint', style: { display: 'none' } }, '공연 모드 · 화면을 탭하면 컨트롤');
  const stage = el('div', { class: 'perf__stage', onClick: onStageTap }, canvas, statusEl, fsBtn, fsHint);

  const bpmVal = el('span', { class: 'val' }, '--');
  const bpmEl = el('div', { class: 'perf__bpm' }, bpmVal, el('span', { class: 'unit' }, 'BPM'));
  const subEl = el('div', { class: 'perf__sub' }, '프리 모드');
  const stabFill = el('div', { class: 'stability__fill' });
  const stabEl = el('div', { class: 'stability' }, '안정도', el('div', { class: 'stability__bar' }, stabFill));
  const readout = el('div', { class: 'perf__readout' }, bpmEl, subEl, stabEl);
  const right = el('div', { class: 'perf__right' }, readout);
  const main = el('div', { class: 'perf__main' }, stage, right);

  // 측정 모드
  const segAlways = el('button', { onClick: () => setMeasureMode('always') }, '항상 측정');
  const segTap = el('button', { onClick: () => setMeasureMode('tap') }, '탭 측정');
  const seg = el('div', { class: 'seg' }, segAlways, segTap);
  const tapBtn = el('button', { class: 'btn', onClick: () => engine.startTapMeasure() }, '측정');
  const freeBtn = el('button', { class: 'btn btn--ghost', onClick: toggleFree }, '프리');
  const modeRow = el('div', { class: 'row row--wrap' }, seg, tapBtn, el('div', { class: 'spacer' }), freeBtn);

  // 곡 이동
  const prevBtn = el('button', { class: 'btn btn--ghost iconbtn', onClick: () => stepSong(-1) }, '◀');
  const nextBtn = el('button', { class: 'btn btn--ghost iconbtn', onClick: () => stepSong(1) }, '▶');
  const songName = el('div', { class: 'perf__songname' }, '곡 없음');
  const songMeta = el('div', { class: 'perf__songmeta' }, '');
  const songInfo = el('div', { class: 'item__main' }, songName, songMeta);
  const songLine = el('div', { class: 'perf__songline' }, prevBtn, songInfo, nextBtn);

  // 구간
  const sectionChip = el('span', { class: 'chip' }, '');
  const nextSectionBtn = el('button', { class: 'btn', onClick: nextSection }, '다음 구간 ▶');
  const sectionLine = el('div', { class: 'row', style: { display: 'none' } }, sectionChip, el('div', { class: 'spacer' }), nextSectionBtn);

  // 트랜스포트
  const micBtn = el('button', { class: 'btn', onClick: onMic }, '🎤 마이크');
  const playBtn = el('button', { class: 'btn btn--primary btn--big', onClick: toggleClick }, '▶ 재생');
  const perfModeBtn = el('button', { class: 'btn btn--ghost', onClick: toggleFullscreen }, '공연모드');
  const transport = el('div', { class: 'perf__transport' }, micBtn, playBtn, perfModeBtn);

  const controls = el('div', { class: 'perf__controls' }, modeRow, songLine, sectionLine, transport);
  const root = el('div', { class: 'screen perf' }, main, controls);

  // --- 로직 ---
  function resolveActive(song: Song | undefined): Active {
    if (!song) return { bpm: 120, meter: '4/4', sectionName: null, sectionCount: 0, idx: 0 };
    if (song.sections && song.sections.length) {
      const idx = Math.max(0, Math.min(sectionIndex, song.sections.length - 1));
      const sec = song.sections[idx];
      return { bpm: sec.bpm, meter: sec.meter || song.meter, sectionName: sec.name, sectionCount: song.sections.length, idx };
    }
    return { bpm: song.defaultBpm, meter: song.meter, sectionName: null, sectionCount: 0, idx: 0 };
  }

  function applyActive(reconfigure = true) {
    const song = store.getSong(currentSongId);
    const act = resolveActive(song);
    sectionIndex = act.idx;
    songName.textContent = song ? song.name : '곡 없음 (프리 모드)';
    songMeta.textContent = song ? `${act.bpm} BPM · ${act.meter}` : '';
    if (act.sectionCount > 0) {
      sectionLine.style.display = '';
      sectionChip.textContent = `구간 ${act.idx + 1}/${act.sectionCount} · ${act.sectionName ?? ''}`;
    } else {
      sectionLine.style.display = 'none';
    }
    engine.setTarget(freeMode ? null : act.bpm);
    if (reconfigure) {
      const s = store.settings;
      engine.configureClick({
        bpm: act.bpm,
        meter: act.meter,
        clickSound: s.clickSound,
        accentBeat1: s.accentBeat1,
        subdivision: s.subdivision,
        volume: s.clickVolume,
        countInBars: s.countIn,
      });
    }
    updateModeUI();
  }

  function setMeasureMode(mode: 'always' | 'tap') {
    measureMode = mode;
    engine.setMeasureMode(mode);
    updateModeUI();
  }
  function updateModeUI() {
    segAlways.classList.toggle('is-on', measureMode === 'always');
    segTap.classList.toggle('is-on', measureMode === 'tap');
    tapBtn.style.display = measureMode === 'tap' ? '' : 'none';
    freeBtn.classList.toggle('is-on', freeMode);
    micBtn.classList.toggle('is-on', engine.micState === 'granted');
    micBtn.textContent = engine.micState === 'granted' ? '🎤 켜짐' : '🎤 마이크';
  }

  function toggleFree() {
    freeMode = !freeMode;
    applyActive(false);
    subEl.textContent = freeMode ? '프리 모드' : '';
  }

  async function onMic() {
    const r = await engine.enableMic();
    await engine.resume();
    if (r === 'denied') {
      toast('마이크 권한이 거부되었습니다');
    } else {
      engine.setMeasureMode(measureMode);
    }
    updateModeUI();
  }

  async function toggleClick() {
    engine.ensureContext();
    await engine.resume();
    if (engine.clickRunning) {
      engine.stopClick();
      finalizeSession();
    } else {
      applyActive(true);
      engine.startClick();
      startSession();
    }
    updatePlayBtn();
    updateWake();
  }
  function updatePlayBtn() {
    const on = engine.clickRunning;
    playBtn.textContent = on ? '■ 정지' : '▶ 재생';
    playBtn.classList.toggle('btn--primary', !on);
    playBtn.classList.toggle('btn--danger', on);
  }

  function stepSong(dir: number) {
    const list = store.getActiveSetlist();
    if (!list || list.songIds.length === 0) {
      toast('셋리스트가 비어 있습니다');
      return;
    }
    let i = currentSongId ? list.songIds.indexOf(currentSongId) : -1;
    i = (i + dir + list.songIds.length) % list.songIds.length;
    loadSong(list.songIds[i]);
  }

  function nextSection() {
    const song = store.getSong(currentSongId);
    if (!song || !song.sections || !song.sections.length) return;
    sectionIndex = (sectionIndex + 1) % song.sections.length;
    applyActive(true);
    const sec = song.sections[sectionIndex];
    toast(`구간 ${sectionIndex + 1}: ${sec.name} · ${sec.bpm} BPM`);
  }

  function loadSong(songId: string | null) {
    finalizeSession();
    currentSongId = songId;
    sectionIndex = 0;
    freeMode = false;
    applyActive(true);
    engine.resetDetection();
    subEl.textContent = '';
  }

  // --- Phase 3 세션 ---
  function startSession() {
    if (freeMode) return;
    const song = store.getSong(currentSongId);
    if (!song) return;
    const act = resolveActive(song);
    session = {
      id: uid(),
      songId: song.id,
      songName: song.name,
      targetBpm: act.bpm,
      startedAt: Date.now(),
      durationMs: 0,
      samples: [],
      _t0: performance.now(),
    };
  }
  function finalizeSession() {
    if (!session) return;
    const dur = performance.now() - session._t0;
    if (session.samples.length >= 10 && dur >= 6000) {
      const rec: Session = {
        id: session.id,
        songId: session.songId,
        songName: session.songName,
        targetBpm: session.targetBpm,
        startedAt: session.startedAt,
        durationMs: Math.round(dur),
        samples: session.samples,
      };
      store.saveSession(rec).then(() => toast('세션 기록 저장됨'));
    }
    session = null;
  }

  function updateWake() {
    const want = store.settings.keepScreenOn && (engine.clickRunning || engine.measuring);
    if (want) wakeLock.enable();
    else wakeLock.disable();
  }

  // --- 전체화면(공연 모드) ---
  function toggleFullscreen() {
    const on = !document.body.classList.contains('fullscreen');
    document.body.classList.toggle('fullscreen', on);
    fsHint.style.display = on ? '' : 'none';
    if (on) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      controls.style.display = '';
    }
    ring?.resize();
  }
  let peekTimer: number | null = null;
  function onStageTap() {
    if (!document.body.classList.contains('fullscreen')) return;
    controls.style.display = 'flex';
    if (peekTimer != null) clearTimeout(peekTimer);
    peekTimer = setTimeout(() => {
      if (document.body.classList.contains('fullscreen')) controls.style.display = '';
    }, 3000) as unknown as number;
  }

  // --- 갱신 루프 ---
  function refresh() {
    const st = engine.getTempoState();
    const s = store.settings;
    const song = store.getSong(currentSongId);
    const act = resolveActive(song);
    const target = freeMode ? null : act.bpm;

    // 숫자
    const show = st.status === 'ok' || st.detected > 0;
    bpmVal.textContent = show ? String(Math.round(st.detected)) : '--';
    if (freeMode) {
      subEl.textContent = '프리 모드';
    } else if (st.status === 'ok' && st.delta != null) {
      const d = st.delta;
      const sign = d >= 0 ? '+' : '−';
      subEl.innerHTML = `목표 ${target} · <span class="perf__delta ${deltaClass(d, s)}">Δ ${sign}${Math.abs(d).toFixed(1)}</span>`;
    } else {
      subEl.textContent = `목표 ${target}`;
    }

    // 안정도
    const stab = Math.round(st.stability * 100);
    stabFill.style.width = (st.status === 'ok' ? stab : 0) + '%';
    stabFill.style.background = st.stability > 0.66 ? 'var(--green)' : st.stability > 0.33 ? 'var(--yellow)' : 'var(--red)';

    // 상태 표시
    setStatus(st.status);

    // 링
    ring?.setView({
      delta: freeMode ? null : st.delta,
      detected: st.detected,
      target,
      stability: st.stability,
      status: st.status,
      running: engine.clickRunning,
      greenThreshold: s.greenThreshold,
      yellowThreshold: s.yellowThreshold,
      needleFullScale: s.needleFullScale,
      beatsPerBar: mainBeatsPerBar(act.meter),
    });

    // Phase 3 로깅(약 150ms 간격)
    logAccum += 1;
    if (session && engine.clickRunning && !freeMode && st.status === 'ok' && logAccum % 2 === 0) {
      const sample: SessionSample = {
        t: Math.round(performance.now() - session._t0),
        bpm: +st.detected.toFixed(2),
        delta: st.delta != null ? +st.delta.toFixed(2) : 0,
      };
      session.samples.push(sample);
    }

    updateWake();
  }

  function setStatus(status: string) {
    statusEl.classList.remove('is-warn', 'is-err');
    if (engine.micState === 'idle' || engine.micState === 'denied') {
      statusEl.textContent = '마이크 권한 필요 — 마이크 버튼을 누르세요';
      statusEl.classList.add('is-warn');
    } else if (measureMode === 'tap' && !engine.measuring) {
      statusEl.textContent = '탭하여 측정';
      statusEl.classList.add('is-warn');
    } else if (status === 'no-signal') {
      statusEl.textContent = '신호 없음 / 박자 불명확';
      statusEl.classList.add('is-err');
    } else if (status === 'measuring') {
      statusEl.textContent = '측정 중…';
    } else {
      statusEl.textContent = '';
    }
  }

  return {
    el: root,
    title: '비트키퍼',
    show(params) {
      if (params && typeof params.songId === 'string') {
        loadSong(params.songId);
      } else if (!currentSongId) {
        const list = store.getActiveSetlist();
        loadSong(list?.songIds[0] ?? null);
      } else {
        applyActive(true);
      }
      measureMode = store.settings.defaultMeasureMode;
      engine.setMeasureMode(measureMode);
      if (!ring) ring = new PulseRing(canvas, () => engine.getAudioTime());
      ring.resize();
      ring.clearPulses();
      engine.onPulse = (e) => ring?.pushPulse(e);
      ring.start();
      updateModeUI();
      updatePlayBtn();
      refresh();
      refreshTimer = setInterval(refresh, 80) as unknown as number;
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', onResize);
    },
    hide() {
      if (refreshTimer != null) clearInterval(refreshTimer);
      refreshTimer = null;
      ring?.stop();
      engine.onPulse = null;
      engine.stopClick();
      finalizeSession();
      updatePlayBtn();
      wakeLock.disable();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (document.body.classList.contains('fullscreen')) toggleFullscreen();
    },
  };

  function onResize() {
    ring?.resize();
  }
}

function deltaClass(d: number, s: { greenThreshold: number; yellowThreshold: number }): string {
  const a = Math.abs(d);
  if (a <= s.greenThreshold) return 'delta-green';
  if (a <= s.yellowThreshold) return 'delta-yellow';
  return 'delta-red';
}

