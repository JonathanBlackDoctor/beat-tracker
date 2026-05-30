// 비트키퍼 — 펄스 링 + 앞섬/처짐 바늘 렌더러 (확정 디자인: design_handoff bk-inst-a / bk-draw)
// Canvas + requestAnimationFrame. UI 리렌더와 분리된 독립 60fps 루프.
// 시각 펄스는 오디오 클럭(AudioContext.currentTime)에 맞춰 큐에서 정확히 발화한다.
//
// 판독 위계 (무대에서 0.5초 흘끗):
//  ① 링 색 = 드리프트 존 (초록≤1.5 · 노랑≤4 · 빨강>4, 설정 가능)
//  ② 바늘 위치 = 앞섬/처짐 (왼쪽=느림/처짐, 오른쪽=빠름/앞섬)
//  ③ 큰 BPM 숫자 + 목표·Δ (DOM 오버레이)

import type { DetectStatus } from '../audio/tempoEngine.ts';
import type { PulseEvent } from '../audio/clickScheduler.ts';

export interface RingView {
  delta: number | null; // detected - target (null = 프리 모드)
  detected: number;
  target: number | null;
  stability: number; // 0..1
  status: DetectStatus;
  running: boolean; // 클릭 재생 중
  greenThreshold: number;
  yellowThreshold: number;
  needleFullScale: number; // ±BPM
  beatsPerBar: number;
}

interface Zone {
  c: string;
  glow: string;
}

// 드리프트 존 색 — 저자극 소프트 톤 (design_handoff bk-core ZONE)
const ZONE: Record<'green' | 'yellow' | 'red' | 'neutral', Zone> = {
  green: { c: '#4fd1a5', glow: 'rgba(79,209,165,0.55)' },
  yellow: { c: '#f4c95f', glow: 'rgba(244,201,95,0.55)' },
  red: { c: '#f2867f', glow: 'rgba(242,134,127,0.55)' },
  neutral: { c: 'rgba(255,255,255,0.2)', glow: 'rgba(56,189,248,0.4)' },
};

function zoneOf(delta: number | null, green: number, yellow: number): Zone {
  if (delta == null) return ZONE.neutral;
  const a = Math.abs(delta);
  if (a <= green) return ZONE.green;
  if (a <= yellow) return ZONE.yellow;
  return ZONE.red;
}

/** 링/바늘/점/안정도 바의 화면 좌표(CSS px). DOM 오버레이 배치에 사용. */
export interface RingGeom {
  cx: number;
  cy: number;
  R: number;
  needleY: number;
  needleHalf: number;
  dotsY: number;
  dotGap: number;
  stabY: number;
}

export class PulseRing {
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private getAudioTime: () => number | null;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private raf: number | null = null;

  private queue: PulseEvent[] = [];
  private accent = false;
  private curBeat = 0;
  private lastOnset = -1; // 마지막 펄스 온셋의 오디오 타임스탬프
  private beatDur = 0.5; // 측정된 박 간격(초)
  private sm = 0; // 바늘 EMA(떨림 억제, α=0.08/frame)
  private env = 0; // 펄스 엔벨로프 0..1

  geom: RingGeom = { cx: 0, cy: 0, R: 1, needleY: 0, needleHalf: 1, dotsY: 0, dotGap: 26, stabY: 0 };

  private view: RingView = {
    delta: null,
    detected: 0,
    target: null,
    stability: 1,
    status: 'measuring',
    running: false,
    greenThreshold: 1.5,
    yellowThreshold: 4,
    needleFullScale: 8,
    beatsPerBar: 4,
  };

  constructor(canvas: HTMLCanvasElement, getAudioTime: () => number | null) {
    this.canvas = canvas;
    this.getAudioTime = getAudioTime;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('2D 컨텍스트를 만들 수 없습니다');
    this.ctx2d = c;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx2d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.layout();
  }

  /** 박스 크기·방향에 맞춰 링/바늘/점/안정도 위치를 계산 (design 비율 기준). */
  private layout() {
    const { w, h } = this;
    const landscape = w / h >= 1.25;
    const cx = w / 2;
    let g: RingGeom;
    if (landscape) {
      // 가로: 링을 무대 중앙 약간 위, 아래로 바늘·점·안정도
      const R = clamp(Math.min(h * 0.34, w * 0.4), 48, 220);
      const cy = h * 0.4;
      const needleY = Math.min(cy + R + h * 0.1, h - 70);
      const dotsY = Math.min(needleY + h * 0.11, h - 40);
      g = { cx, cy, R, needleY, needleHalf: Math.min(R, w * 0.42), dotsY, dotGap: 28, stabY: Math.min(dotsY + h * 0.12, h - 14) };
    } else {
      // 세로: design 인스트루먼트(384×452) 비율 그대로 스케일
      const R = clamp(Math.min(h * 0.257, w * 0.32), 56, 220);
      g = {
        cx,
        cy: h * 0.332,
        R,
        needleY: h * 0.664,
        needleHalf: Math.min(w * 0.4, 150),
        dotsY: h * 0.765,
        dotGap: 26,
        stabY: h * 0.867,
      };
    }
    this.geom = g;
  }

  setView(v: Partial<RingView>) {
    Object.assign(this.view, v);
  }

  pushPulse(e: PulseEvent) {
    this.queue.push(e);
    if (this.queue.length > 64) this.queue.shift();
  }

  clearPulses() {
    this.queue.length = 0;
    this.lastOnset = -1;
    this.env = 0;
  }

  start() {
    if (this.raf != null) return;
    const loop = () => {
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  private frame() {
    const at = this.getAudioTime();

    // 오디오 클럭으로 펄스 온셋 발화 (스케줄러가 권위, setInterval 드리프트 금지)
    if (at != null) {
      while (this.queue.length && this.queue[0].time <= at) {
        const e = this.queue.shift()!;
        if (this.lastOnset >= 0) {
          const d = e.time - this.lastOnset;
          if (d > 0.12 && d < 2) this.beatDur = d;
        }
        this.lastOnset = e.time;
        this.accent = e.accent;
        this.curBeat = e.beatIndex;
      }
    }

    // 펄스 엔벨로프: 어택 6% 선형 상승 → 감쇠 (1−p)^1.7 (design 애니메이션 사양)
    if (this.view.running && at != null && this.lastOnset >= 0) {
      const p = clamp((at - this.lastOnset) / this.beatDur, 0, 1);
      this.env = p < 0.06 ? p / 0.06 : Math.pow(1 - (p - 0.06) / 0.94, 1.7);
    } else {
      this.env = 0;
    }

    // 바늘 EMA (α = 0.08 / frame)
    const tgtDelta = this.view.delta ?? 0;
    this.sm += (tgtDelta - this.sm) * 0.08;

    this.draw();
  }

  private draw() {
    const ctx = this.ctx2d;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const v = this.view;
    const { cx, cy, R, needleY, needleHalf, dotsY } = this.geom;
    const live = v.status === 'ok' && v.delta != null;
    const detectedKnown = v.status === 'ok' && (v.detected > 0 || v.delta != null);
    const zone = detectedKnown ? zoneOf(v.delta, v.greenThreshold, v.yellowThreshold) : ZONE.neutral;
    const env = this.env;

    // 1) 정지 가이드 링 (희미)
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // 2) 펄스 링: 어택 시 +5%(1박 강세 +6.5%) 확대, 글로우 blur 8→34, 선 4→9
    const rr = R * (1 + 0.05 * env * (this.accent ? 1.3 : 1));
    ctx.save();
    ctx.shadowColor = zone.glow;
    ctx.shadowBlur = live ? 8 + 26 * env : 0;
    ctx.strokeStyle = live ? zone.c : 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 4 + 5 * env;
    ctx.globalAlpha = live ? 0.5 + 0.5 * env : 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 3) 앞섬/처짐 바늘 트랙 (가로) — 왼쪽=처짐/느림, 오른쪽=앞섬/빠름
    this.drawNeedle(ctx, cx, needleY, needleHalf, this.sm, zone, live, v.needleFullScale);

    // 4) 박자 점
    this.drawDots(ctx, cx, dotsY, v.beatsPerBar, this.curBeat, env, v.running);
  }

  private drawNeedle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    y: number,
    halfW: number,
    pos: number,
    zone: Zone,
    live: boolean,
    full: number,
  ) {
    // 기준선
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - halfW, y);
    ctx.lineTo(cx + halfW, y);
    ctx.stroke();
    // 양 끝 눈금
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    for (const dx of [-halfW, halfW]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx, y - 6);
      ctx.lineTo(cx + dx, y + 6);
      ctx.stroke();
    }
    // 중앙 목표 눈금 (더 길게)
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.beginPath();
    ctx.moveTo(cx, y - 11);
    ctx.lineTo(cx, y + 11);
    ctx.stroke();
    ctx.lineCap = 'butt';
    if (!live) return;
    // 움직이는 마커
    const mx = cx + clamp(pos / full, -1, 1) * halfW;
    ctx.save();
    ctx.shadowColor = zone.glow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = zone.c;
    ctx.beginPath();
    ctx.arc(mx, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 중앙→마커 연결선 (방향 표시)
    ctx.strokeStyle = zone.c;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(mx, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawDots(
    ctx: CanvasRenderingContext2D,
    cx: number,
    y: number,
    beats: number,
    beat: number,
    env: number,
    running: boolean,
  ) {
    const n = Math.max(1, beats);
    const gap = this.geom.dotGap;
    const r = 4.5;
    const totalW = (n - 1) * gap;
    for (let i = 0; i < n; i++) {
      const x = cx - totalW / 2 + i * gap;
      const active = running && i === beat;
      const isAccent = i === 0;
      ctx.beginPath();
      ctx.arc(x, y, isAccent ? r + 1.5 : r, 0, Math.PI * 2);
      if (active) {
        ctx.save();
        ctx.shadowColor = 'rgba(233,234,238,0.5)';
        ctx.shadowBlur = 10 * (0.4 + 0.6 * env);
        ctx.fillStyle = '#e9eaee';
        ctx.globalAlpha = 0.6 + 0.4 * env;
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fill();
      }
      if (isAccent && !active) {
        ctx.strokeStyle = 'rgba(255,255,255,0.34)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}
