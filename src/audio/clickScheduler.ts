// 비트키퍼 — lookahead 클릭/펄스 스케줄러 (브리프 §3, §5)
// "두 개의 시계" 패턴: setInterval(~25ms)로 깨어나 AudioContext.currentTime 기준
// ~100ms 앞까지 클릭을 샘플 단위로 미리 예약한다. setInterval 자체로 박자를 치지 않는다(드리프트 금지).
// 시각 펄스는 오디오 클릭과 동일한 타임스탬프(+출력 레이턴시)로 콜백되어 정확히 동기.

import type { ClickSound, Meter, Subdivision } from '../types.ts';
import { mainBeatsPerBar } from '../types.ts';

const LOOKAHEAD = 0.1; // 미리 예약하는 시간(초)
const TICK_MS = 25; // 스케줄러 깨어나는 주기

export interface PulseEvent {
  /** 시각 펄스를 띄울 AudioContext 시간(초). 출력 레이턴시 반영. */
  time: number;
  /** 강세(1박/카운트인 다운비트) 여부 */
  accent: boolean;
  /** 마디 내 메인 박 인덱스 (0-base) */
  beatIndex: number;
  beatsPerBar: number;
  /** 카운트인 중인지 */
  countIn: boolean;
}

interface ClickConfig {
  bpm: number;
  meter: Meter;
  clickSound: ClickSound;
  accentBeat1: boolean;
  subdivision: Subdivision;
  /** 0..1 */
  volume: number;
  /** 시작 전 카운트인 마디 수 */
  countInBars: number;
}

type Level = 'accent' | 'normal' | 'weak';

/** 클릭 한 종류/강도를 짧은 AudioBuffer 로 사전 합성(프레임마다 할당 회피) */
function renderClick(ctx: BaseAudioContext, sound: ClickSound, level: Level): AudioBuffer {
  const sr = ctx.sampleRate;
  const dur = level === 'accent' ? 0.045 : level === 'normal' ? 0.038 : 0.025;
  const len = Math.max(1, Math.floor(sr * dur));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);

  const gain = level === 'accent' ? 1.0 : level === 'normal' ? 0.72 : 0.42;
  let f1: number, f2: number, decay: number, noise = 0;
  switch (sound) {
    case 'beep':
      f1 = level === 'accent' ? 1568 : level === 'normal' ? 1175 : 880;
      f2 = 0;
      decay = 60;
      break;
    case 'woodblock':
      f1 = level === 'accent' ? 1300 : level === 'normal' ? 1000 : 760;
      f2 = f1 * 1.5;
      decay = 90;
      noise = 0.12;
      break;
    case 'hihat':
      f1 = 0;
      f2 = 0;
      decay = level === 'accent' ? 70 : 110;
      noise = 1;
      break;
    case 'rim':
    default:
      f1 = level === 'accent' ? 2200 : level === 'normal' ? 1800 : 1500;
      f2 = 0;
      decay = 150;
      noise = 0.25;
      break;
  }

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.exp(-decay * t);
    let s = 0;
    if (f1 > 0) s += Math.sin(2 * Math.PI * f1 * t);
    if (f2 > 0) s += 0.5 * Math.sin(2 * Math.PI * f2 * t);
    if (noise > 0) s += noise * (Math.random() * 2 - 1);
    // 초반 1ms 트랜지언트 클릭 강조
    const attack = i < sr * 0.001 ? 1.4 : 1;
    d[i] = s * env * gain * attack * 0.9;
  }
  // 정규화 가드
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 1) for (let i = 0; i < len; i++) d[i] /= peak;
  return buf;
}

export class ClickScheduler {
  private ctx: AudioContext;
  private out: GainNode; // 볼륨 제어
  private cfg: ClickConfig = {
    bpm: 120,
    meter: '4/4',
    clickSound: 'woodblock',
    accentBeat1: true,
    subdivision: 'off',
    volume: 0.8,
    countInBars: 0,
  };

  private timer: number | null = null;
  private nextNoteTime = 0;
  private bar = 0;
  private beat = 0; // 메인 박 인덱스
  private sub = 0; // 서브디비전 스텝
  private subPerBeat = 1;
  private secPerBeat = 0.5;
  private countInLeft = 0;
  private buffers: Record<Level, AudioBuffer> | null = null;
  private bufferSound: ClickSound | null = null;

  onPulse: ((e: PulseEvent) => void) | null = null;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.cfg.volume;
    this.out.connect(destination);
  }

  get isRunning() {
    return this.timer !== null;
  }

  setConfig(partial: Partial<ClickConfig>) {
    Object.assign(this.cfg, partial);
    if (partial.volume != null) {
      this.out.gain.setTargetAtTime(this.cfg.volume, this.ctx.currentTime, 0.01);
    }
    if (partial.clickSound && partial.clickSound !== this.bufferSound) {
      this.buffers = null; // 다음 클릭에서 재생성
    }
  }

  private ensureBuffers() {
    if (this.buffers && this.bufferSound === this.cfg.clickSound) return;
    this.buffers = {
      accent: renderClick(this.ctx, this.cfg.clickSound, 'accent'),
      normal: renderClick(this.ctx, this.cfg.clickSound, 'normal'),
      weak: renderClick(this.ctx, this.cfg.clickSound, 'weak'),
    };
    this.bufferSound = this.cfg.clickSound;
  }

  private subdivisionsPerBeat(): number {
    const { meter, subdivision } = this.cfg;
    if (meter === '6/8') {
      // 메인 박 = 점4분(3 eighth). off→메인만, 8분→3, 16분→6
      return subdivision === '16' ? 6 : subdivision === '8' ? 3 : 1;
    }
    return subdivision === '16' ? 4 : subdivision === '8' ? 2 : 1;
  }

  /** 연주(또는 카운트인) 시작 */
  start() {
    if (this.timer !== null) return;
    this.ensureBuffers();
    this.bar = 0;
    this.beat = 0;
    this.sub = 0;
    this.beginBeat();
    this.countInLeft = this.cfg.countInBars * mainBeatsPerBar(this.cfg.meter);
    this.nextNoteTime = this.ctx.currentTime + 0.12;
    this.timer = setInterval(() => this.schedule(), TICK_MS) as unknown as number;
    this.schedule();
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 메인 박 시작 시 bpm/서브디비전을 읽어 고정(박 중간 점프 방지) */
  private beginBeat() {
    this.secPerBeat = 60 / Math.max(1, this.cfg.bpm);
    this.subPerBeat = this.subdivisionsPerBeat();
  }

  private schedule() {
    const ctx = this.ctx;
    while (this.nextNoteTime < ctx.currentTime + LOOKAHEAD) {
      this.scheduleTick(this.nextNoteTime);
      this.advance();
    }
  }

  private scheduleTick(time: number) {
    this.ensureBuffers();
    const beatsPerBar = mainBeatsPerBar(this.cfg.meter);

    if (this.countInLeft > 0) {
      // 카운트인: 메인 박만, 마디 첫 박 강세
      const isDown = this.beat === 0;
      this.playBuffer(isDown ? 'accent' : 'normal', time);
      this.emitPulse(time, isDown && this.cfg.accentBeat1, this.beat, beatsPerBar, true);
      return;
    }

    const isMain = this.sub === 0;
    if (isMain) {
      const isDown = this.beat === 0 && this.cfg.accentBeat1;
      this.playBuffer(isDown ? 'accent' : 'normal', time);
      this.emitPulse(time, isDown, this.beat, beatsPerBar, false);
    } else {
      this.playBuffer('weak', time);
    }
  }

  private emitPulse(
    time: number,
    accent: boolean,
    beatIndex: number,
    beatsPerBar: number,
    countIn: boolean,
  ) {
    if (!this.onPulse) return;
    const latency = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    this.onPulse({ time: time + latency, accent, beatIndex, beatsPerBar, countIn });
  }

  private playBuffer(level: Level, time: number) {
    if (!this.buffers) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[level];
    src.connect(this.out);
    src.start(time);
  }

  private advance() {
    if (this.countInLeft > 0) {
      this.countInLeft--;
      this.nextNoteTime += this.secPerBeat;
      this.beat++;
      if (this.beat >= mainBeatsPerBar(this.cfg.meter)) this.beat = 0;
      if (this.countInLeft === 0) {
        // 본 연주 시작점으로 리셋
        this.bar = 0;
        this.beat = 0;
        this.sub = 0;
        this.beginBeat();
      }
      return;
    }

    this.nextNoteTime += this.secPerBeat / this.subPerBeat;
    this.sub++;
    if (this.sub >= this.subPerBeat) {
      this.sub = 0;
      this.beat++;
      if (this.beat >= mainBeatsPerBar(this.cfg.meter)) {
        this.beat = 0;
        this.bar++;
      }
      this.beginBeat(); // 다음 박 bpm/서브디비전 갱신
    }
  }
}
