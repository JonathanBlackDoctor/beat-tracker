import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// 비트키퍼 PWA 빌드 설정.
// - 서비스워커가 앱 셸 전체를 프리캐시 → 첫 로드 후 완전 오프라인 (브리프 §3, §9).
// - AudioWorklet 은 public/onset-worklet.js 로 그대로 서빙되어 빌드 후 dist 루트에 복사되고
//   precache glob(**/*.js)에 포함된다.
export default defineConfig({
  // 마이크/오디오는 보안 컨텍스트(localhost 또는 HTTPS)에서만 동작한다.
  // GitHub Pages 프로젝트 사이트는 서브경로(/beat-tracker/)에서 서빙된다.
  // 로컬 dev/preview 는 기본 '/'. CI 빌드는 VITE_BASE 로 지정.
  base: process.env.VITE_BASE ?? '/',
  server: { host: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.svg',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png',
        'onset-worklet.js',
      ],
      manifest: {
        name: '비트키퍼',
        short_name: '비트키퍼',
        description: '밴드 퍼커션용 실시간 템포 보조 — 감지·메트로놈·셋리스트 (오프라인)',
        lang: 'ko',
        dir: 'ltr',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0a0a0c',
        theme_color: '#0a0a0c',
        start_url: '.',
        scope: '.',
        categories: ['music', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 모든 앱 셸 자산을 프리캐시 (완전 오프라인)
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: {
        // 개발 중에도 SW 동작 → 오프라인 테스트 가능
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ],
});
