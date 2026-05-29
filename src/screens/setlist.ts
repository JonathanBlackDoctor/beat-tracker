// 비트키퍼 — 셋리스트 화면 (브리프 §4.2)
import { store } from '../state/store.ts';
import { el, clear, toast, openSheet, promptText, confirmAction } from '../ui.ts';
import type { AppCtx, ScreenController } from '../ui.ts';
import type { Song } from '../types.ts';

function songMeta(s: Song): string {
  const sec = s.sections && s.sections.length ? ` · ${s.sections.length}구간` : '';
  return `${s.defaultBpm} BPM · ${s.meter}${sec}`;
}

export function createSetlistScreen(app: AppCtx): ScreenController {
  const header = el('div', { class: 'card', style: { padding: '12px', marginBottom: '12px' } });
  const listEl = el('div', { class: 'list' });
  const footer = el('div', { class: 'row', style: { marginTop: '14px' } });
  const scroll = el('div', { class: 'scroll' }, header, el('div', { class: 'section-title' }, '곡 목록'), listEl, footer);
  const root = el('div', { class: 'screen' }, scroll);
  let unsub: (() => void) | null = null;

  let dragEl: HTMLElement | null = null;

  function onHandleDown(e: PointerEvent, itemEl: HTMLElement) {
    e.preventDefault();
    e.stopPropagation();
    dragEl = itemEl;
    itemEl.classList.add('is-drag');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }
  function onMove(e: PointerEvent) {
    if (!dragEl) return;
    const items = Array.from(listEl.querySelectorAll<HTMLElement>('.item'));
    for (const it of items) {
      if (it === dragEl) continue;
      const r = it.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        listEl.insertBefore(dragEl, it);
        return;
      }
    }
    listEl.appendChild(dragEl);
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    if (!dragEl) return;
    dragEl.classList.remove('is-drag');
    const ids = Array.from(listEl.querySelectorAll<HTMLElement>('.item'))
      .map((it) => it.dataset.id || '')
      .filter(Boolean);
    const active = store.getActiveSetlist();
    dragEl = null;
    if (active) void store.setSetlistOrder(active.id, ids);
  }

  function renderHeader() {
    clear(header);
    const active = store.getActiveSetlist();
    const select = el('select', {
      onChange: (e: Event) => store.setActiveSetlist((e.target as HTMLSelectElement).value),
    }) as HTMLSelectElement;
    for (const sl of store.setlists) {
      const opt = el('option', { value: sl.id }, `${sl.name} (${sl.songIds.length})`) as HTMLOptionElement;
      if (active && sl.id === active.id) opt.selected = true;
      select.appendChild(opt);
    }
    const actions = el(
      'div',
      { class: 'row', style: { marginTop: '10px' } },
      el('button', { class: 'btn btn--ghost', style: { flex: '1' }, onClick: renameSetlist }, '이름변경'),
      el('button', { class: 'btn btn--ghost', style: { flex: '1' }, onClick: newSetlist }, '+ 새 셋리스트'),
      el('button', { class: 'btn btn--danger', onClick: deleteSetlist }, '삭제'),
    );
    header.append(el('label', { style: { fontSize: '13px', color: 'var(--muted)' } }, '활성 셋리스트'), select, actions);
  }

  async function renameSetlist() {
    const active = store.getActiveSetlist();
    if (!active) return;
    const name = await promptText('셋리스트 이름변경', '이름', active.name);
    if (name) {
      active.name = name;
      await store.upsertSetlist(active);
    }
  }
  async function newSetlist() {
    const name = await promptText('새 셋리스트', '이름', '');
    if (name != null) await store.createSetlist(name || '새 셋리스트');
  }
  async function deleteSetlist() {
    const active = store.getActiveSetlist();
    if (!active) return;
    if (store.setlists.length <= 1) {
      toast('마지막 셋리스트는 삭제할 수 없습니다');
      return;
    }
    if (await confirmAction('셋리스트 삭제', `"${active.name}"을(를) 삭제할까요? (곡 자체는 남습니다)`)) {
      await store.deleteSetlist(active.id);
    }
  }

  function renderList() {
    clear(listEl);
    const active = store.getActiveSetlist();
    if (!active || active.songIds.length === 0) {
      listEl.append(el('div', { class: 'empty' }, '곡이 없습니다. 아래 “곡 추가”로 담아보세요.'));
      return;
    }
    for (const id of active.songIds) {
      const song = store.getSong(id);
      if (!song) continue;
      const handle = el('div', { class: 'handle', title: '드래그로 순서 변경' }, '☰');
      handle.addEventListener('pointerdown', (e) => onHandleDown(e as PointerEvent, item));
      const info = el(
        'div',
        { class: 'item__main', onClick: () => app.navigate('performance', { songId: song.id }) },
        el('div', { class: 'item__title' }, song.name),
        el('div', { class: 'item__meta' }, songMeta(song)),
      );
      const actions = el(
        'div',
        { class: 'item__actions' },
        el('button', { class: 'btn btn--ghost iconbtn', title: '연주', onClick: () => app.navigate('performance', { songId: song.id }) }, '▶'),
        el('button', { class: 'btn btn--ghost iconbtn', title: '편집', onClick: () => app.navigate('editor', { songId: song.id }) }, '✎'),
        el('button', { class: 'btn btn--ghost iconbtn', title: '복제', onClick: () => duplicate(song.id) }, '⧉'),
        el('button', { class: 'btn btn--ghost iconbtn', title: '목록에서 빼기', onClick: () => removeFromList(song.id) }, '✕'),
      );
      const item = el('div', { class: 'item', dataset: { id: song.id } }, handle, info, actions);
      listEl.append(item);
    }
  }

  async function duplicate(songId: string) {
    const copy = await store.duplicateSong(songId);
    const active = store.getActiveSetlist();
    if (copy && active) await store.addSongToSetlist(active.id, copy.id);
    toast('곡을 복제했습니다');
  }
  async function removeFromList(songId: string) {
    const active = store.getActiveSetlist();
    if (active) await store.removeSongFromSetlist(active.id, songId);
  }

  function renderFooter() {
    clear(footer);
    footer.append(
      el('button', { class: 'btn btn--block', style: { flex: '1' }, onClick: openAddSheet }, '＋ 곡 추가'),
      el('button', { class: 'btn btn--primary', style: { flex: '1' }, onClick: newSong }, '＋ 새 곡'),
    );
  }

  function openAddSheet() {
    const active = store.getActiveSetlist();
    if (!active) return;
    const inList = new Set(active.songIds);
    const candidates = store.songs.filter((s) => !inList.has(s.id));
    const body = el('div', { class: 'list' });
    if (candidates.length === 0) {
      body.append(el('div', { class: 'empty' }, '추가할 곡이 없습니다. “새 곡”을 만들어 보세요.'));
    }
    for (const s of candidates) {
      body.append(
        el(
          'div',
          {
            class: 'item',
            onClick: async () => {
              await store.addSongToSetlist(active.id, s.id);
              toast(`"${s.name}" 추가됨`);
              close();
            },
          },
          el('div', { class: 'item__main' }, el('div', { class: 'item__title' }, s.name), el('div', { class: 'item__meta' }, songMeta(s))),
          el('span', { class: 'chip' }, '추가'),
        ),
      );
    }
    const close = openSheet('곡 추가', body);
  }

  function newSong() {
    const active = store.getActiveSetlist();
    app.navigate('editor', { setlistId: active?.id });
  }

  function render() {
    renderHeader();
    renderList();
    renderFooter();
  }

  return {
    el: root,
    title: '셋리스트',
    show() {
      render();
      unsub = store.subscribe(render);
    },
    hide() {
      unsub?.();
      unsub = null;
    },
  };
}
