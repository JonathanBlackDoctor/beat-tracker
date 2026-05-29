// 비트키퍼 — 기록·리뷰 화면 (브리프 §4 / §8 Phase 3)
// 곡 재생 중 로깅된 감지 BPM·Δ 시계열을 시간축 그래프(목표선 포함)로 표시. 원음 저장 없음.
import { store } from '../state/store.ts';
import { el, clear, toast, confirmAction } from '../ui.ts';
import type { AppCtx, ScreenController } from '../ui.ts';
import type { Session } from '../types.ts';

function fmtDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date(ts).toLocaleString();
  }
}
function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}분 ${s % 60}초`;
}

export function createReviewScreen(_app: AppCtx): ScreenController {
  const listWrap = el('div', { class: 'list' });
  const detail = el('div', null);
  const scroll = el('div', { class: 'scroll' }, el('div', { class: 'section-title' }, '최근 세션'), listWrap, detail);
  const root = el('div', { class: 'screen' }, scroll);
  let unsub: (() => void) | null = null;
  let songFilter: string | null = null;
  let selected: Session | null = null;

  function sessions(): Session[] {
    return songFilter ? store.getSessionsForSong(songFilter) : store.recentSessions(30);
  }

  function renderList() {
    clear(listWrap);
    const list = sessions();
    if (list.length === 0) {
      listWrap.append(el('div', { class: 'empty' }, '아직 기록이 없습니다. 연주 화면에서 곡을 재생하면 템포 기록이 저장됩니다.'));
      return;
    }
    for (const s of list) {
      const item = el(
        'div',
        { class: 'item', onClick: () => { selected = s; renderDetail(); detail.scrollIntoView({ behavior: 'smooth' }); } },
        el('div', { class: 'item__main' },
          el('div', { class: 'item__title' }, s.songName),
          el('div', { class: 'item__meta' }, `${fmtDate(s.startedAt)} · ${fmtDur(s.durationMs)} · 목표 ${s.targetBpm}`),
        ),
        el('span', { class: 'chip' }, `${s.samples.length}점`),
      );
      if (selected && selected.id === s.id) item.classList.add('drop-target');
      listWrap.append(item);
    }
  }

  function stats(s: Session) {
    const bpms = s.samples.map((x) => x.bpm);
    const n = bpms.length || 1;
    const avg = bpms.reduce((a, b) => a + b, 0) / n;
    const variance = bpms.reduce((a, b) => a + (b - avg) * (b - avg), 0) / n;
    const std = Math.sqrt(variance);
    const maxAbs = s.samples.reduce((m, x) => Math.max(m, Math.abs(x.delta)), 0);
    const g = store.settings.greenThreshold;
    const inGreen = s.samples.filter((x) => Math.abs(x.delta) <= g).length;
    const pctGreen = Math.round((inGreen / n) * 100);
    return { avg, std, maxAbs, pctGreen };
  }

  function renderDetail() {
    clear(detail);
    if (!selected) return;
    const s = selected;
    const st = stats(s);

    const canvas = el('canvas', { class: 'review-graph' }) as HTMLCanvasElement;
    const legend = el('div', { class: 'legend' },
      el('span', null, el('i', { style: { background: 'var(--accent)' } }), '감지 BPM'),
      el('span', null, el('i', { style: { background: 'var(--muted)' } }), `목표 ${s.targetBpm}`),
      el('span', null, el('i', { style: { background: 'rgba(52,211,153,0.5)' } }), `안정 구간(±${store.settings.greenThreshold})`),
    );
    const statRow = el('div', { class: 'row row--wrap', style: { marginTop: '10px', gap: '14px' } },
      stat('평균', `${st.avg.toFixed(1)} BPM`),
      stat('표준편차', `${st.std.toFixed(2)}`),
      stat('최대 편차', `${st.maxAbs.toFixed(1)} BPM`),
      stat('안정 비율', `${st.pctGreen}%`),
    );
    const del = el('button', { class: 'btn btn--danger btn--block', style: { marginTop: '14px' }, onClick: async () => {
      if (await confirmAction('세션 삭제', `"${s.songName}" 기록을 삭제할까요?`)) {
        await store.deleteSession(s.id);
        selected = null;
        toast('삭제됨');
      }
    } }, '이 기록 삭제');

    detail.append(
      el('div', { class: 'divider' }),
      el('div', { class: 'section-title' }, `${s.songName} — 템포 타임라인`),
      canvas,
      legend,
      statRow,
      del,
    );
    requestAnimationFrame(() => drawGraph(canvas, s));
  }

  function stat(label: string, value: string) {
    return el('div', { style: { flex: '1', minWidth: '120px' } },
      el('div', { class: 'hint' }, label),
      el('div', { style: { fontSize: '20px', fontWeight: '800' } }, value),
    );
  }

  function drawGraph(canvas: HTMLCanvasElement, s: Session) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const cssW = canvas.clientWidth || 320;
    const cssH = 220;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 44, padR = 12, padT = 14, padB = 26;
    const W = cssW - padL - padR;
    const H = cssH - padT - padB;
    const target = s.targetBpm;
    const g = store.settings.greenThreshold;

    let maxDev = 4;
    for (const x of s.samples) maxDev = Math.max(maxDev, Math.abs(x.bpm - target));
    maxDev = Math.min(maxDev + 1, 30);
    const yMin = target - maxDev;
    const yMax = target + maxDev;
    const dur = Math.max(1, s.durationMs);

    const xOf = (t: number) => padL + (t / dur) * W;
    const yOf = (bpm: number) => padT + (1 - (bpm - yMin) / (yMax - yMin)) * H;

    // 안정 구간 밴드
    ctx.fillStyle = 'rgba(52,211,153,0.14)';
    ctx.fillRect(padL, yOf(target + g), W, yOf(target - g) - yOf(target + g));

    // 격자/축 라벨 (BPM)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px system-ui, sans-serif';
    ctx.lineWidth = 1;
    for (const v of [yMin, target, yMax]) {
      const y = yOf(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + W, y);
      ctx.stroke();
      ctx.fillText(v.toFixed(0), 6, y + 4);
    }

    // 목표선
    ctx.strokeStyle = '#9aa0aa';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(padL, yOf(target));
    ctx.lineTo(padL + W, yOf(target));
    ctx.stroke();
    ctx.setLineDash([]);

    // BPM 곡선
    if (s.samples.length) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      s.samples.forEach((x, i) => {
        const px = xOf(x.t);
        const py = yOf(Math.max(yMin, Math.min(yMax, x.bpm)));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }

    // x축 시간 라벨
    ctx.fillStyle = '#6b7280';
    ctx.fillText('0:00', padL, cssH - 8);
    const totalS = Math.round(dur / 1000);
    const label = `${Math.floor(totalS / 60)}:${String(totalS % 60).padStart(2, '0')}`;
    ctx.fillText(label, padL + W - 26, cssH - 8);
  }

  function render() {
    renderList();
    if (selected && !store.sessions.find((x) => x.id === selected!.id)) selected = null;
    renderDetail();
  }

  return {
    el: root,
    title: '기록 · 리뷰',
    show(params) {
      songFilter = params && typeof params.songId === 'string' ? params.songId : null;
      selected = null;
      render();
      unsub = store.subscribe(render);
      window.addEventListener('resize', onResize);
    },
    hide() {
      unsub?.();
      unsub = null;
      window.removeEventListener('resize', onResize);
    },
  };

  function onResize() {
    const canvas = detail.querySelector('canvas');
    if (canvas && selected) drawGraph(canvas as HTMLCanvasElement, selected);
  }
}
