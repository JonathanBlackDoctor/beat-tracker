// 비트키퍼 — 펄스 링 + 앞섬/처짐 바늘 렌더러 (브리프 §4.1)
// Canvas + requestAnimationFrame. UI 리렌더와 분리된 독립 60fps 루프.
// 시각 펄스는 오디오 클럭(AudioContext.currentTime)에 맞춰 큐에서 정확히 발화한다.

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

const COLORS = {
  green: '#34d399',
  yellow: '#fbbf24',
  red: '#f87171',
  neutral: '#38bdf8',
  dim: '#2a2a33',
  dimRing: '#3a3a46',
  text: '#e8e8ea',
  muted: '#6b7280',
};

function zoneColor(delta: number | null, green: number, yellow: number): string {
  if (delta == null) return COLORS.neutral;
  const a = Math.abs(delta);
  if (a <= green) return COLORS.green;
  if (a <= yellow) return COLORS.yellow;
  return COLORS.red;
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
  private pulseAmp = 0;
  private accent = false;
  private curBeat = 0;
  private jitter = 0; // 안정도 시각화용 저역통과 떨림
  private lastFrame = 0;

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
  }

  start() {
    if (this.raf != null) return;
    this.lastFrame = performance.now();
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
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    // 오디오 클럭으로 펄스 발화
    const at = this.getAudioTime();
    if (at != null) {
      while (this.queue.length && this.queue[0].time <= at) {
        const e = this.queue.shift()!;
        this.pulseAmp = 1;
        this.accent = e.accent;
        this.curBeat = e.beatIndex;
      }
    }
    // 펄스 감쇠
    this.pulseAmp *= Math.exp(-dt / 0.14);
    if (this.pulseAmp < 0.001) this.pulseAmp = 0;

    // 안정도 떨림(저역통과한 랜덤)
    const target = (1 - this.view.stability) * (Math.random() * 2 - 1);
    this.jitter += (target - this.jitter) * Math.min(1, dt * 12);

    this.draw();
  }

  private draw() {
    const ctx = this.ctx2d;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.4;
    const v = this.view;
    const ok = v.status === 'ok';
    const color =
      ok || v.delta == null ? zoneColor(v.delta, v.greenThreshold, v.yellowThreshold) : COLORS.muted;

    // 바깥 가이드 링(흐림)
    ctx.lineWidth = Math.max(2, R * 0.02);
    ctx.strokeStyle = COLORS.dimRing;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // 펄스 링
    const amp = this.pulseAmp;
    const pulseR = R * (1 + 0.07 * amp);
    const accentBoost = this.accent ? 1.5 : 1;
    ctx.lineWidth = Math.max(3, R * (0.05 + 0.06 * amp) * accentBoost);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35 + 0.65 * amp;
    ctx.shadowColor = color;
    ctx.shadowBlur = 24 * amp * accentBoost;
    ctx.beginPath();
    ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // 내부 채움(은은)
    const grad = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
    grad.addColorStop(0, `rgba(255,255,255,${0.04 + 0.06 * amp})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.98, 0, Math.PI * 2);
    ctx.fill();

    // 앞섬/처짐 바늘 — 중앙=목표 일치, 좌=처짐(느림), 우=앞섬(빠름)
    const half = R * 0.82;
    // 중앙 기준선
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - R * 0.5);
    ctx.lineTo(cx, cy - R * 0.18);
    ctx.moveTo(cx, cy + R * 0.18);
    ctx.lineTo(cx, cy + R * 0.5);
    ctx.stroke();

    if (v.delta != null && ok) {
      const norm = Math.max(-1, Math.min(1, v.delta / v.needleFullScale));
      const jitterPx = this.jitter * R * 0.04;
      const nx = cx + norm * half + jitterPx;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(4, R * 0.04);
      ctx.lineCap = 'round';
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(nx, cy - R * 0.46);
      ctx.lineTo(nx, cy + R * 0.46);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // 상단 화살촉
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(nx, cy - R * 0.52);
      ctx.lineTo(nx - R * 0.05, cy - R * 0.4);
      ctx.lineTo(nx + R * 0.05, cy - R * 0.4);
      ctx.closePath();
      ctx.fill();
    } else {
      // 중앙 그레이 표시(측정 중/무신호/프리)
      ctx.strokeStyle = COLORS.muted;
      ctx.lineWidth = Math.max(3, R * 0.03);
      ctx.beginPath();
      ctx.moveTo(cx, cy - R * 0.3);
      ctx.lineTo(cx, cy + R * 0.3);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // 중앙 허브
    ctx.fillStyle = COLORS.text;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.05, 0, Math.PI * 2);
    ctx.fill();

    // 박자 점 — 하단 호
    const beats = Math.max(1, v.beatsPerBar);
    const dotR = R * 0.045;
    const spacing = Math.min(R * 0.42, (R * 1.4) / beats);
    const totalW = spacing * (beats - 1);
    const by = cy + R * 1.18 < h ? cy + R * 1.18 : h - dotR * 2.2;
    for (let i = 0; i < beats; i++) {
      const x = cx - totalW / 2 + i * spacing;
      const active = v.running && i === this.curBeat;
      const isDown = i === 0;
      ctx.beginPath();
      ctx.arc(x, by, dotR * (isDown ? 1.35 : 1) * (active ? 1.25 : 1), 0, Math.PI * 2);
      if (active) {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
      } else {
        ctx.fillStyle = COLORS.dim;
        ctx.shadowBlur = 0;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}
