// 비트키퍼 — 설정 화면 (브리프 §4.4 · 확정 디자인: design_handoff bk-screens2)
import { store } from '../state/store.ts';
import { engine } from '../audio/audioEngine.ts';
import { canInstall, promptInstall, onInstallAvailabilityChange } from '../pwa.ts';
import { el, clear, toast } from '../ui.ts';
import type { AppCtx, ScreenController } from '../ui.ts';
import type { Settings } from '../types.ts';

export function createSettingsScreen(_app: AppCtx): ScreenController {
  const form = el('div', { class: 'list' });
  const scroll = el('div', { class: 'scroll' }, form);
  const root = el('div', { class: 'screen' }, scroll);
  let offInstall: (() => void) | null = null;

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    void store.saveSettings({ [key]: value } as Partial<Settings>);
  }

  function groupLabel(text: string): HTMLElement {
    return el('div', { class: 'section-title' }, text);
  }

  // 라벨 좌측 / 컨트롤 우측 카드 행
  function rowCard(label: Node | string, control: HTMLElement, sub?: string): HTMLElement {
    const labelEl = el('div', { class: 'setting__label' }, el('b', null, label), sub ? el('small', null, sub) : null);
    return el('div', { class: 'setting' }, labelEl, control);
  }

  // 라벨 위 / 전체폭 컨트롤 아래 카드 (세그먼트·슬라이더)
  function stackCard(label: Node | string, control: HTMLElement, hint?: HTMLElement): HTMLElement {
    const top = el('div', { class: 'setting__top' }, el('div', { class: 'setting__label' }, el('b', null, label)), hint || null);
    return el('div', { class: 'setting setting--stack' }, top, control);
  }

  function toggle(get: () => boolean, onChange: (v: boolean) => void): HTMLElement {
    const sw = el('div', { class: 'switch' + (get() ? ' is-on' : '') });
    sw.addEventListener('click', () => {
      const v = !sw.classList.contains('is-on');
      sw.classList.toggle('is-on', v);
      onChange(v);
    });
    return sw;
  }

  function segmented(opts: [string, string][], get: () => string, onChange: (v: string) => void, full = false): HTMLElement {
    const seg = el('div', { class: 'seg', style: full ? { display: 'flex', width: '100%' } : undefined });
    const paint = () => Array.from(seg.children).forEach((c) => (c as HTMLElement).classList.toggle('is-on', (c as HTMLElement).dataset.v === get()));
    for (const [value, label] of opts) {
      seg.appendChild(el('button', { dataset: { v: value }, onClick: () => { onChange(value); paint(); } }, label));
    }
    paint();
    return seg;
  }

  function slider(min: number, max: number, step: number, get: () => number, onInput: (v: number) => void): HTMLInputElement {
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) }) as HTMLInputElement;
    const paint = () => input.style.setProperty('--pct', ((+input.value - min) / (max - min)) * 100 + '%');
    input.addEventListener('input', () => { paint(); onInput(+input.value); });
    paint();
    return input;
  }

  function render() {
    clear(form);
    const s = store.settings;

    // ── 메트로놈 ──
    form.append(groupLabel('메트로놈'));

    form.append(
      stackCard('클릭음',
        segmented([['woodblock', '우드'], ['beep', '비프'], ['hihat', '하이햇'], ['rim', '림']],
          () => s.clickSound,
          (v) => { set('clickSound', v as Settings['clickSound']); engine.scheduler?.setConfig({ clickSound: v as Settings['clickSound'] }); }, true)),
    );

    const volHint = el('span', { class: 'setting__hint' }, Math.round(s.clickVolume * 100) + '%');
    form.append(
      stackCard('클릭 볼륨',
        slider(0, 100, 5, () => Math.round(s.clickVolume * 100), (v) => { const f = v / 100; set('clickVolume', f); engine.scheduler?.setConfig({ volume: f }); volHint.textContent = v + '%'; }),
        volHint),
    );

    form.append(
      rowCard('1박 강세', toggle(() => s.accentBeat1, (v) => set('accentBeat1', v)), '마디 첫 박을 강하게'),
      rowCard('카운트인', segmented([['0', '끔'], ['1', '1마디'], ['2', '2마디']], () => String(s.countIn), (v) => set('countIn', Number(v) as Settings['countIn']))),
      rowCard('잘게 쪼개기', segmented([['off', '끔'], ['8', '8분'], ['16', '16분']], () => s.subdivision, (v) => set('subdivision', v as Settings['subdivision']))),
    );

    // ── 드리프트 색 임계값 ──
    form.append(groupLabel('드리프트 색 임계값'));
    const greenHint = el('span', { class: 'setting__hint' }, '±' + s.greenThreshold.toFixed(1) + ' BPM');
    const yellowHint = el('span', { class: 'setting__hint' }, '±' + s.yellowThreshold.toFixed(1) + ' BPM');
    form.append(
      stackCard(dotLabel('green', '초록 (일치)'),
        slider(0.5, 3, 0.5, () => s.greenThreshold, (v) => { set('greenThreshold', v); greenHint.textContent = '±' + v.toFixed(1) + ' BPM'; }),
        greenHint),
      stackCard(dotLabel('yellow', '노랑 (주의)'),
        slider(3, 8, 0.5, () => s.yellowThreshold, (v) => { set('yellowThreshold', v); yellowHint.textContent = '±' + v.toFixed(1) + ' BPM'; }),
        yellowHint),
    );

    // ── 일반 ──
    form.append(groupLabel('일반'));
    form.append(
      rowCard('진동 피드백', toggle(() => s.vibration, (v) => set('vibration', v)), '거치 시 체감이 적어 기본 off'),
      rowCard('측정 기본 모드', segmented([['always', '항상'], ['tap', '탭']], () => s.defaultMeasureMode, (v) => set('defaultMeasureMode', v as Settings['defaultMeasureMode']))),
      rowCard('화면 항상 켜둠', toggle(() => s.keepScreenOn, (v) => set('keepScreenOn', v)), '연주 중 화면 꺼짐 방지 (Wake Lock)'),
      rowCard('언어', el('span', { class: 'setting__hint' }, '한국어 ›')),
    );

    // ── 고급 ──
    form.append(groupLabel('고급'));
    const fsHint = el('span', { class: 'setting__hint' }, '±' + s.needleFullScale + ' BPM');
    form.append(
      stackCard('바늘 풀스케일',
        slider(2, 30, 1, () => s.needleFullScale, (v) => { set('needleFullScale', v); fsHint.textContent = '±' + v + ' BPM'; }),
        fsHint),
      rowCard('구간 자동 전환', toggle(() => s.autoAdvanceSections, (v) => set('autoAdvanceSections', v)), '바 수 기반 자동 전환 (기본 off=수동)'),
    );

    // ── 설치 ──
    form.append(groupLabel('앱'));
    const installBtn = el('button', { class: 'btn btn--primary btn--block', onClick: doInstall }, '홈 화면에 설치');
    if (!canInstall()) {
      installBtn.setAttribute('disabled', 'true');
      installBtn.textContent = '설치 가능 시 여기에 표시됩니다';
    }
    form.append(installBtn, el('div', { class: 'hint', style: { marginTop: '2px', padding: '0 4px' } }, '안드로이드 크롬: 메뉴 → “홈 화면에 추가”로도 설치할 수 있습니다. 첫 로드 후 완전 오프라인 동작.'));
  }

  function dotLabel(kind: 'green' | 'yellow', text: string): HTMLElement {
    return el('span', null, el('span', { class: 'dot ' + kind }), text);
  }

  async function doInstall() {
    const ok = await promptInstall();
    toast(ok ? '설치되었습니다' : '설치가 취소되었습니다');
  }

  return {
    el: root,
    title: '설정',
    show() {
      render();
      offInstall = onInstallAvailabilityChange(render);
    },
    hide() {
      offInstall?.();
      offInstall = null;
    },
  };
}
