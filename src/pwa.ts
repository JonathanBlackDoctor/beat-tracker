// 비트키퍼 — PWA 인프라: Wake Lock(연주 중 화면 유지), 설치 프롬프트 (브리프 §3, §9)
/* eslint-disable @typescript-eslint/no-explicit-any */

class WakeLockManager {
  private sentinel: any = null;
  private wanted = false;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wanted) void this.request();
    });
  }

  async enable() {
    this.wanted = true;
    await this.request();
  }

  async disable() {
    this.wanted = false;
    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch {
        /* noop */
      }
      this.sentinel = null;
    }
  }

  private async request() {
    const nav = navigator as any;
    if (!('wakeLock' in nav) || this.sentinel) return;
    try {
      this.sentinel = await nav.wakeLock.request('screen');
      this.sentinel.addEventListener?.('release', () => {
        this.sentinel = null;
      });
    } catch {
      /* 권한/배터리 절약 등으로 실패 가능 — 무시 */
    }
  }
}

export const wakeLock = new WakeLockManager();

// --- 설치 프롬프트 ---
let deferredPrompt: any = null;
const installListeners = new Set<() => void>();

window.addEventListener('beforeinstallprompt', (e: Event) => {
  e.preventDefault();
  deferredPrompt = e;
  installListeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installListeners.forEach((fn) => fn());
});

export function canInstall(): boolean {
  return !!deferredPrompt;
}

export function onInstallAvailabilityChange(fn: () => void): () => void {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null;
  installListeners.forEach((fn) => fn());
  return choice?.outcome === 'accepted';
}

/** 진동 피드백(설정 on + 지원 시) */
export function vibrate(pattern: number | number[]) {
  try {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* noop */
  }
}
