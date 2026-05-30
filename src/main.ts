// 비트키퍼 — 앱 부트스트랩 + 라우터
import './styles.css';
import { store } from './state/store.ts';
import { engine } from './audio/audioEngine.ts';
import { toast, icon, ICONS } from './ui.ts';
import type { AppCtx, Route, ScreenController } from './ui.ts';
import { createPerformanceScreen } from './screens/performance.ts';
import { createSetlistScreen } from './screens/setlist.ts';
import { createSongEditorScreen } from './screens/songEditor.ts';
import { createSettingsScreen } from './screens/settings.ts';
import { createReviewScreen } from './screens/review.ts';

const appRoot = document.getElementById('app')!;

const topbarTitle = document.createElement('div');
topbarTitle.className = 'topbar__title';
const topbarRight = document.createElement('div');
topbarRight.className = 'topbar__right';
const topbar = document.createElement('div');
topbar.className = 'topbar';
topbar.append(topbarTitle, topbarRight);

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
  if (!current) return;
  const ctrl = current.ctrl;
  // 상단바: 연주 화면은 브랜드 워드마크, 그 외엔 제목
  topbarTitle.className = ctrl.brand ? 'brand' : 'topbar__title';
  if (ctrl.brand) {
    topbarTitle.textContent = '비트키퍼';
    const latin = document.createElement('span');
    latin.textContent = 'BEATKEEPER';
    topbarTitle.append(latin);
  } else {
    topbarTitle.textContent = ctrl.title;
  }
  topbarRight.replaceChildren();
  if (ctrl.headerRight) topbarRight.append(ctrl.headerRight);
}

const NAV_ITEMS: { route: Route; icon: string; label: string; fill?: boolean }[] = [
  { route: 'performance', icon: ICONS.play, label: '연주', fill: true },
  { route: 'setlist', icon: ICONS.list, label: '셋리스트' },
  { route: 'review', icon: ICONS.chart, label: '기록' },
  { route: 'settings', icon: ICONS.gear, label: '설정' },
];

function buildNav() {
  for (const it of NAV_ITEMS) {
    const b = document.createElement('button');
    b.dataset.route = it.route;
    b.append(
      icon(it.icon, it.fill ? { fill: 'currentColor', stroke: 'none' } : { sw: 1.7 }),
      Object.assign(document.createElement('span'), { textContent: it.label }),
    );
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
