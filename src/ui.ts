// 비트키퍼 — 경량 DOM 헬퍼 + 라우팅 타입

export type Route = 'performance' | 'setlist' | 'editor' | 'settings' | 'review';

export interface AppCtx {
  navigate(route: Route, params?: Record<string, unknown>): void;
  toast(msg: string): void;
  /** 상단바/내비 등 공통 크롬 갱신 */
  refreshChrome(): void;
}

export interface ScreenController {
  el: HTMLElement;
  title: string;
  subtitle?: string;
  /** 상단바에 브랜드 워드마크(비트키퍼 · BEATKEEPER)로 표시 */
  brand?: boolean;
  /** 상단바 우측 액션 슬롯 (예: 공연 모드 버튼) */
  headerRight?: HTMLElement;
  show?(params?: Record<string, unknown>): void;
  hide?(): void;
}

type ElChild = Node | string | number | null | undefined | false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function el(tag: string, props?: Record<string, any> | null, ...children: ElChild[]): HTMLElement {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') node.className = String(v);
      else if (k === 'html') node.innerHTML = String(v);
      else if (k === 'text') node.textContent = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k in node && k !== 'list') {
        // 속성(value, checked, type, placeholder 등)
        try {
          (node as unknown as Record<string, unknown>)[k] = v;
        } catch {
          node.setAttribute(k, String(v));
        }
      } else {
        node.setAttribute(k, String(v));
      }
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node: Node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ── SVG 아이콘 (디자인 핸드오프 line-icon 시스템) ──
const SVGNS = 'http://www.w3.org/2000/svg';

/** SVG 아이콘 생성. inner 는 path/rect 등 SVG 마크업 문자열. */
export function icon(
  inner: string,
  opts: { fill?: string; stroke?: string; sw?: number; viewBox?: string } = {},
): SVGSVGElement {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', opts.viewBox ?? '0 0 24 24');
  s.setAttribute('fill', opts.fill ?? 'none');
  s.setAttribute('stroke', opts.stroke ?? (opts.fill && opts.fill !== 'none' ? 'none' : 'currentColor'));
  s.setAttribute('stroke-width', String(opts.sw ?? 1.8));
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = inner;
  return s;
}

/** 아이콘 path 데이터 (design_handoff bk-ui / bk-screen 기준) */
export const ICONS = {
  play: '<path d="M7 4l13 8-13 8z"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  expand: '<path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/>',
  expandCorners: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  chart: '<path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-7"/>',
  gear: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l1.5 1-1 2-1.8-.4-1.3 1.3.4 1.8-2 1-1-1.5h-2l-1 1.5-2-1 .4-1.8L4.6 15 2.8 15.4l-1-2L3.3 12 1.8 11l1-2 1.8.4 1.3-1.3L5.5 6.3l2-1 1 1.5h2l1-1.5 2 1-.4 1.8 1.3 1.3 1.8-.4 1 2L19 12z"/>',
  grip: '<path d="M8 7h.01M8 12h.01M8 17h.01M16 7h.01M16 12h.01M16 17h.01"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
} as const;

let toastTimer: number | null = null;
export function toast(msg: string, ms = 1800) {
  let t = document.querySelector<HTMLElement>('.toast');
  if (!t) {
    t = el('div', { class: 'toast' });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = 'block';
  if (toastTimer != null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (t) t.style.display = 'none';
  }, ms) as unknown as number;
}

/** 하단 시트(모달) 표시. close() 반환 */
export function openSheet(title: string, content: HTMLElement): () => void {
  const sheet = el('div', { class: 'sheet' }, el('div', { class: 'sheet__title' }, title), content);
  const backdrop = el('div', { class: 'sheet-backdrop' }, sheet);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.body.appendChild(backdrop);
  return close;
}

export function meterBeats(meter: string): number {
  return meter === '6/8' ? 2 : meter === '3/4' ? 3 : 4;
}

/** 텍스트 입력 시트. 확인 시 값, 취소 시 null */
export function promptText(title: string, label: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const input = el('input', { type: 'text', value: initial }) as HTMLInputElement;
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      close();
      resolve(v);
    };
    const body = el(
      'div',
      null,
      el('div', { class: 'field' }, el('label', null, label), input),
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn btn--ghost', style: { flex: '1' }, onClick: () => finish(null) }, '취소'),
        el('button', { class: 'btn btn--primary', style: { flex: '1' }, onClick: () => finish(input.value.trim()) }, '확인'),
      ),
    );
    const close = openSheet(title, body);
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') finish(input.value.trim());
    });
    setTimeout(() => input.focus(), 50);
  });
}

/** 확인 시트. 확인 true / 취소 false */
export function confirmAction(title: string, message: string, confirmLabel = '삭제'): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      close();
      resolve(v);
    };
    const body = el(
      'div',
      null,
      el('p', { style: { color: 'var(--muted)', margin: '0 0 16px' } }, message),
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn btn--ghost', style: { flex: '1' }, onClick: () => finish(false) }, '취소'),
        el('button', { class: 'btn btn--danger', style: { flex: '1' }, onClick: () => finish(true) }, confirmLabel),
      ),
    );
    const close = openSheet(title, body);
  });
}
