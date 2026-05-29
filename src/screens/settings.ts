// 비트키퍼 — 설정 화면 (브리프 §4.4)
import { store } from '../state/store.ts';
import { engine } from '../audio/audioEngine.ts';
import { canInstall, promptInstall, onInstallAvailabilityChange } from '../pwa.ts';
import { el, clear, toast } from '../ui.ts';
import type { AppCtx, ScreenController } from '../ui.ts';
import type { Settings } from '../types.ts';

export function createSettingsScreen(_app: AppCtx): ScreenController {
  const form = el('div', null);
  const scroll = el('div', { class: 'scroll' }, form);
  const root = el('div', { class: 'screen' }, scroll);
  let offInstall: (() => void) | null = null;

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    void store.saveSettings({ [key]: value } as Partial<Settings>);
  }

  function switchRow(title: string, sub: string, get: () => boolean, onChange: (v: boolean) => void) {
    const sw = el('div', { class: 'switch' + (get() ? ' is-on' : '') });
    sw.addEventListener('click', () => {
      const v = !sw.classList.contains('is-on');
      sw.classList.toggle('is-on', v);
      onChange(v);
    });
    return el('div', { class: 'setting' }, el('div', { class: 'setting__label' }, el('b', null, title), el('small', null, sub)), sw);
  }

  function segRow(title: string, opts: { label: string; value: string }[], get: () => string, onChange: (v: string) => void) {
    const seg = el('div', { class: 'seg' });
    const paint = () => {
      Array.from(seg.children).forEach((c) => {
        const b = c as HTMLElement;
        b.classList.toggle('is-on', b.dataset.v === get());
      });
    };
    for (const o of opts) {
      const b = el('button', { dataset: { v: o.value }, onClick: () => { onChange(o.value); paint(); } }, o.label);
      seg.appendChild(b);
    }
    paint();
    return el('div', { class: 'field' }, el('label', null, title), seg);
  }

  function render() {
    clear(form);
    const s = store.settings;

    // 클릭음
    form.append(
      segRow('클릭음', [
        { label: '우드블록', value: 'woodblock' },
        { label: '비프', value: 'beep' },
        { label: '하이햇', value: 'hihat' },
        { label: '림', value: 'rim' },
      ], () => s.clickSound, (v) => { set('clickSound', v as Settings['clickSound']); engine.scheduler?.setConfig({ clickSound: v as Settings['clickSound'] }); }),
    );

    // 볼륨
    const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.clickVolume) }) as HTMLInputElement;
    vol.addEventListener('input', () => {
      const v = +vol.value;
      set('clickVolume', v);
      engine.scheduler?.setConfig({ volume: v });
    });
    form.append(el('div', { class: 'field' }, el('label', null, `클릭 볼륨`), vol));

    // 강세 / 카운트인 / 쪼개기
    form.append(
      switchRow('1박 강세', '마디 첫 박을 강하게', () => s.accentBeat1, (v) => set('accentBeat1', v)),
      segRow('카운트인', [
        { label: 'off', value: '0' },
        { label: '1마디', value: '1' },
        { label: '2마디', value: '2' },
      ], () => String(s.countIn), (v) => set('countIn', Number(v) as Settings['countIn'])),
      segRow('잘게 쪼개기', [
        { label: 'off', value: 'off' },
        { label: '8분', value: '8' },
        { label: '16분', value: '16' },
      ], () => s.subdivision, (v) => set('subdivision', v as Settings['subdivision'])),
    );

    // 측정 기본 모드
    form.append(
      segRow('측정 기본 모드', [
        { label: '항상 측정', value: 'always' },
        { label: '탭 측정', value: 'tap' },
      ], () => s.defaultMeasureMode, (v) => set('defaultMeasureMode', v as Settings['defaultMeasureMode'])),
    );

    // 드리프트 색 임계값
    const green = el('input', { type: 'number', step: '0.5', min: '0.5', value: String(s.greenThreshold) }) as HTMLInputElement;
    const yellow = el('input', { type: 'number', step: '0.5', min: '1', value: String(s.yellowThreshold) }) as HTMLInputElement;
    const commitThresholds = () => {
      let g = Math.max(0.5, +green.value || 1.5);
      let y = Math.max(g + 0.5, +yellow.value || 4);
      green.value = String(g);
      yellow.value = String(y);
      void store.saveSettings({ greenThreshold: g, yellowThreshold: y });
    };
    green.addEventListener('change', commitThresholds);
    yellow.addEventListener('change', commitThresholds);
    form.append(
      el('div', { class: 'field' },
        el('label', null, '드리프트 색 임계값 (BPM)'),
        el('div', { class: 'row' },
          el('div', { style: { flex: '1' } }, el('div', { class: 'hint' }, '초록 ≤'), green),
          el('div', { style: { flex: '1' } }, el('div', { class: 'hint' }, '노랑 ≤ (초과=빨강)'), yellow),
        ),
      ),
    );

    // 진동 / 화면 유지
    form.append(
      switchRow('진동 피드백', '거치 시 체감이 적어 기본 off', () => s.vibration, (v) => set('vibration', v)),
      switchRow('화면 항상 켜둠', '연주 중 화면 꺼짐 방지 (Wake Lock)', () => s.keepScreenOn, (v) => set('keepScreenOn', v)),
    );

    // 고급
    form.append(el('div', { class: 'divider' }), el('div', { class: 'section-title' }, '고급'));
    const fs = el('input', { type: 'number', step: '1', min: '2', max: '30', value: String(s.needleFullScale) }) as HTMLInputElement;
    fs.addEventListener('change', () => { const v = Math.max(2, Math.min(30, +fs.value || 8)); fs.value = String(v); set('needleFullScale', v); });
    form.append(el('div', { class: 'field' }, el('label', null, '바늘 풀스케일 (±BPM)'), fs));
    form.append(switchRow('구간 자동 전환', '바 수 기반 자동 전환(기본 off=수동)', () => s.autoAdvanceSections, (v) => set('autoAdvanceSections', v)));

    // 언어 / 설치
    form.append(el('div', { class: 'field' }, el('label', null, '언어'), el('select', { disabled: true }, el('option', null, '한국어'))));

    const installBtn = el('button', { class: 'btn btn--primary btn--block', onClick: doInstall }, '홈 화면에 설치');
    if (!canInstall()) {
      installBtn.setAttribute('disabled', 'true');
      installBtn.textContent = '설치 가능 시 여기에 표시됩니다';
    }
    form.append(el('div', { class: 'divider' }), installBtn, el('div', { class: 'hint', style: { marginTop: '8px' } }, '안드로이드 크롬: 메뉴 → “홈 화면에 추가”로도 설치할 수 있습니다. 첫 로드 후 완전 오프라인 동작.'));
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
