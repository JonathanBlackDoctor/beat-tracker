// 비트키퍼 — 곡 편집 화면 (브리프 §4.3)
import { store, uid } from '../state/store.ts';
import { engine } from '../audio/audioEngine.ts';
import { el, clear, toast, openSheet, confirmAction, icon, ICONS } from '../ui.ts';
import type { AppCtx, ScreenController } from '../ui.ts';
import type { Song, Meter } from '../types.ts';
import { METERS } from '../types.ts';

const clampBpm = (n: number) => Math.max(40, Math.min(240, Math.round(n || 0)));

export function createSongEditorScreen(app: AppCtx): ScreenController {
  let draft: Song = blankSong();
  let isNew = true;
  let addToSetlistId: string | null = null;

  const form = el('div', null);
  const scroll = el('div', { class: 'scroll' }, form);
  const root = el('div', { class: 'screen' }, scroll);

  function blankSong(): Song {
    return { id: uid(), name: '', defaultBpm: 120, meter: '4/4', notes: '', sections: [] };
  }

  function meterSelect(value: Meter | '' | undefined, allowInherit: boolean, onChange: (v: Meter | '') => void) {
    const sel = el('select', { onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value as Meter | '') }) as HTMLSelectElement;
    if (allowInherit) {
      const o = el('option', { value: '' }, '상속') as HTMLOptionElement;
      if (!value) o.selected = true;
      sel.appendChild(o);
    }
    for (const m of METERS) {
      const o = el('option', { value: m }, m) as HTMLOptionElement;
      if (value === m) o.selected = true;
      sel.appendChild(o);
    }
    return sel;
  }

  function meterSegment(getVal: () => Meter, setVal: (m: Meter) => void): HTMLElement {
    const seg = el('div', { class: 'seg', style: { display: 'flex', width: '100%' } });
    const paint = () => Array.from(seg.children).forEach((c) => (c as HTMLElement).classList.toggle('is-on', (c as HTMLElement).dataset.v === getVal()));
    for (const m of METERS) seg.append(el('button', { dataset: { v: m }, onClick: () => { setVal(m); paint(); } }, m));
    paint();
    return seg;
  }

  function bpmStepper(getVal: () => number, setVal: (n: number) => void): HTMLElement {
    const input = el('input', { type: 'number', inputmode: 'numeric', min: '40', max: '240', value: String(getVal()) }) as HTMLInputElement;
    input.addEventListener('change', () => {
      const v = clampBpm(+input.value);
      setVal(v);
      input.value = String(v);
    });
    const dec = el('button', { class: 'btn', onClick: () => { const v = clampBpm(getVal() - 1); setVal(v); input.value = String(v); } }, '−');
    const inc = el('button', { class: 'btn', onClick: () => { const v = clampBpm(getVal() + 1); setVal(v); input.value = String(v); } }, '＋');
    return el('div', { class: 'stepper' }, dec, input, inc);
  }

  function renderSections() {
    const wrap = el('div', { class: 'list' });
    const secs = draft.sections || [];
    if (secs.length === 0) {
      wrap.append(el('div', { class: 'hint' }, '구간이 없으면 단일 템포 곡입니다. 곡 중간 템포 변화가 있으면 구간을 추가하세요.'));
    }
    secs.forEach((sec, i) => {
      const nameI = el('input', { type: 'text', value: sec.name, placeholder: `구간 ${i + 1}`, onInput: (e: Event) => (sec.name = (e.target as HTMLInputElement).value) }) as HTMLInputElement;
      const barsI = el('input', { type: 'number', inputmode: 'numeric', min: '0', placeholder: '바 수(선택)', value: sec.bars != null ? String(sec.bars) : '', onChange: (e: Event) => { const v = +(e.target as HTMLInputElement).value; sec.bars = v > 0 ? v : undefined; } }) as HTMLInputElement;
      const row = el(
        'div',
        { class: 'card', style: { padding: '10px', marginBottom: '8px' } },
        el('div', { class: 'row', style: { marginBottom: '8px' } },
          nameI,
          el('button', { class: 'btn btn--ghost iconbtn', title: '위로', onClick: () => moveSection(i, -1) }, '▲'),
          el('button', { class: 'btn btn--ghost iconbtn', title: '아래로', onClick: () => moveSection(i, 1) }, '▼'),
          el('button', { class: 'btn btn--ghost iconbtn', title: '삭제', onClick: () => { secs.splice(i, 1); rebuild(); } }, '✕'),
        ),
        el('div', { class: 'row' },
          el('div', { style: { flex: '1' } }, el('label', { class: 'hint' }, 'BPM'), bpmStepper(() => sec.bpm, (n) => (sec.bpm = n))),
          el('div', null, el('label', { class: 'hint' }, '박자표'), meterSelect(sec.meter, true, (v) => (sec.meter = v ? (v as Meter) : undefined))),
        ),
        el('div', { style: { marginTop: '8px' } }, barsI),
      );
      wrap.append(row);
    });
    const addRow = el('button', { class: 'addrow', style: { marginTop: '6px' }, onClick: addSection });
    addRow.append(icon(ICONS.plus, { sw: 2 }), el('span', null, '구간 추가'));
    wrap.append(addRow);
    return wrap;
  }

  function addSection() {
    if (!draft.sections) draft.sections = [];
    const base = draft.sections.length ? draft.sections[draft.sections.length - 1].bpm : draft.defaultBpm;
    draft.sections.push({ id: uid(), name: `구간 ${draft.sections.length + 1}`, bpm: base });
    rebuild();
  }
  function moveSection(i: number, dir: number) {
    const secs = draft.sections;
    if (!secs) return;
    const j = i + dir;
    if (j < 0 || j >= secs.length) return;
    [secs[i], secs[j]] = [secs[j], secs[i]];
    rebuild();
  }

  // 탭 템포
  function openTapTempo() {
    let taps: number[] = [];
    const readout = el('div', { class: 'perf__bpm', style: { textAlign: 'center' } }, '--', el('span', { class: 'unit' }, 'BPM'));
    const count = el('div', { class: 'tap-count' }, '버튼을 박자에 맞춰 4번 이상 누르세요');
    let computed = 0;
    const pad = el('button', { class: 'btn btn--primary tap-pad btn--block', onClick: () => {
      const now = performance.now();
      taps.push(now);
      if (taps.length > 8) taps.shift();
      if (taps.length >= 2) {
        const intervals: number[] = [];
        for (let k = 1; k < taps.length; k++) intervals.push(taps[k] - taps[k - 1]);
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        computed = clampBpm(60000 / avg);
        readout.firstChild!.textContent = String(computed);
        count.textContent = `${taps.length}회 · ${computed} BPM`;
      }
    } }, '여기를 탭');
    const reset = el('button', { class: 'btn btn--ghost', onClick: () => { taps = []; computed = 0; readout.firstChild!.textContent = '--'; count.textContent = '버튼을 박자에 맞춰 4번 이상 누르세요'; } }, '초기화');
    const apply = el('button', { class: 'btn btn--primary', onClick: () => { if (computed) { draft.defaultBpm = computed; rebuild(); toast(`목표 ${computed} BPM`); } close(); } }, '적용');
    const body = el('div', null, readout, count, el('div', { style: { height: '12px' } }), pad, el('div', { class: 'row', style: { marginTop: '10px' } }, reset, el('div', { class: 'spacer' }), apply));
    const close = openSheet('탭 템포', body);
  }

  async function autoDetect() {
    toast('마이크로 듣는 중… 약 4초');
    const bpm = await engine.captureTempo(4500);
    if (bpm) {
      draft.defaultBpm = bpm;
      rebuild();
      toast(`자동 인식: ${bpm} BPM`);
    } else {
      toast('인식 실패 — 마이크 권한/소리를 확인하세요');
    }
  }

  function rebuild() {
    clear(form);
    const nameI = el('input', { type: 'text', value: draft.name, placeholder: '곡명', onInput: (e: Event) => (draft.name = (e.target as HTMLInputElement).value) }) as HTMLInputElement;

    form.append(
      el('div', { class: 'field' }, el('label', null, '곡명'), nameI),
      el('div', { class: 'field' },
        el('label', null, '기본 목표 BPM'),
        bpmStepper(() => draft.defaultBpm, (n) => (draft.defaultBpm = n)),
        el('div', { class: 'row', style: { marginTop: '8px' } },
          el('button', { class: 'btn btn--ghost', style: { flex: '1' }, onClick: openTapTempo }, '탭 템포'),
          el('button', { class: 'btn btn--ghost', style: { flex: '1' }, onClick: autoDetect }, '자동 인식'),
        ),
      ),
      el('div', { class: 'field' }, el('label', null, '박자표'), meterSegment(() => draft.meter, (m) => (draft.meter = m))),
      el('div', { class: 'field' }, el('label', null, '메모 / 큐 (선택)'), el('textarea', { placeholder: '인트로 큐, 주의사항 등', value: draft.notes || '', onInput: (e: Event) => (draft.notes = (e.target as HTMLTextAreaElement).value) })),
      el('div', { class: 'divider' }),
      el('div', { class: 'section-title' }, '구간 (곡 중간 템포 변화)'),
      renderSections(),
      el('div', { class: 'divider' }),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn--ghost', style: { flex: '1' }, onClick: () => app.navigate('setlist') }, '취소'),
        isNew ? null : el('button', { class: 'btn btn--danger', onClick: remove }, '삭제'),
        el('button', { class: 'btn btn--primary', style: { flex: '2' }, onClick: save }, '저장'),
      ),
    );
  }

  async function save() {
    if (!draft.name.trim()) {
      toast('곡명을 입력하세요');
      return;
    }
    draft.defaultBpm = clampBpm(draft.defaultBpm);
    if (draft.sections && draft.sections.length === 0) draft.sections = undefined;
    if (draft.sections) draft.sections.forEach((s) => (s.bpm = clampBpm(s.bpm)));
    await store.upsertSong(draft);
    if (isNew && addToSetlistId) await store.addSongToSetlist(addToSetlistId, draft.id);
    toast('저장됨');
    app.navigate('setlist');
  }
  async function remove() {
    if (await confirmAction('곡 삭제', `"${draft.name}"을(를) 삭제할까요?`)) {
      await store.deleteSong(draft.id);
      toast('삭제됨');
      app.navigate('setlist');
    }
  }

  return {
    el: root,
    title: '곡 편집',
    show(params) {
      addToSetlistId = (params && typeof params.setlistId === 'string') ? params.setlistId : null;
      const songId = params && typeof params.songId === 'string' ? params.songId : null;
      const existing = songId ? store.getSong(songId) : undefined;
      if (existing) {
        draft = structuredClone(existing) as Song;
        if (!draft.sections) draft.sections = [];
        isNew = false;
      } else {
        draft = blankSong();
        isNew = true;
      }
      rebuild();
    },
  };
}
