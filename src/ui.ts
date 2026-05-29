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
