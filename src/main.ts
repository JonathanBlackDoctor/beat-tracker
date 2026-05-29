// 비트키퍼 — 앱 부트스트랩 + 라우터
import './styles.css';
import { store } from './state/store.ts';
import { engine } from './audio/audioEngine.ts';
import { toast } from './ui.ts';
import type { AppCtx, Route, ScreenController } from './ui.ts';
import { createPerformanceScreen } from './screens/performance.ts';
import { createSetlistScreen } from './screens/setlist.ts';
import { createSongEditorScreen } from './screens/songEditor.ts';
import { createSettingsScreen } from './screens/settings.ts';
import { createReviewScreen } from './screens/review.ts';

const appRoot = document.getElementById('app')!;

const topbarTitle = document.createElement('div');
topbarTitle.className = 'topbar__title';
const topbar = document.createElement('div');
topbar.className = 'topbar';
topbar.append(topbarTitle);

const container = document.createElement('div');
container.className = 'screen';
container.style.flex = '1';
container.style.minHeight = '0';

const nav = document.createElement('nav');
nav.className = 'nav';

appRoot.append(topbar, container, nav);

let current: { route: Route; ctrl: ScreenController } | null = null;
const cache = new Map<Route, ScreenController>();

const app: AppCtx = { navigate, toast, refreshChrome };

const factories: Record<Route, (a: AppCtx) => ScreenController> = {
  performance: createPerformanceScreen,
  setlist: createSetlistScreen,
  editor: createSongEditorScreen,
  settings: createSettingsScreen,
  review: createReviewScreen,
};

function getCtrl(route: Route): ScreenController {
  let c = cache.get(route);
  if (!c) {
    c = factories[route](app);
    cache.set(route, c);
  }
  return c;
}

function navigate(route: Route, params?: Record<string, unknown>) {
  if (current) {
    current.ctrl.hide?.();
    current.ctrl.el.remove();
  }
  const ctrl = getCtrl(route);
  container.append(ctrl.el);
  ctrl.show?.(params);
  current = { route, ctrl };
  refreshChrome();
  paintNav(route);
}

function refreshChrome() {
  if (current) topbarTitle.textContent = current.ctrl.title;
}

const NAV_ITEMS: { route: Route; icon: string; label: string }[] = [
  { route: 'performance', icon: '▶', label: '연주' },
  { route: 'setlist', icon: '☰', label: '셋리스트' },
  { route: 'review', icon: '≡', label: '기록' },
  { route: 'settings', icon: '⚙', label: '설정' },
];

function buildNav() {
  for (const it of NAV_ITEMS) {
    const b = document.createElement('button');
    b.dataset.route = it.route;
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.textContent = it.icon;
    const lb = document.createElement('span');
    lb.textContent = it.label;
    b.append(ic, lb);
    b.addEventListener('click', () => navigate(it.route));
    nav.append(b);
  }
}

function paintNav(route: Route) {
  // editor 는 셋리스트 탭으로 표시
  const activeTab: Route = route === 'editor' ? 'setlist' : route;
  Array.from(nav.children).forEach((c) => {
    const b = c as HTMLElement;
    b.classList.toggle('is-active', b.dataset.route === activeTab);
  });
}

// 백그라운드 전환: 클릭 정지 + Wake Lock 해제(브리프 §9 엣지케이스)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) engine.suspendForBackground();
});

async function boot() {
  buildNav();
  try {
    await store.init();
  } catch (e) {
    console.error('저장소 초기화 실패', e);
  }
  navigate('performance');
}

void boot();
