// 비트키퍼 — 오디오 허브 (브리프 §3, §6)
// AudioContext 생성, 마이크 입력(에코제거/노이즈억제/AGC 모두 OFF), 온셋 워클릿 연결,
// 템포 트래커 구동, 클릭 스케줄러 보유. 마이크 오디오는 기기를 떠나지 않는다.

import { TempoTracker } from './tempoEngine.ts';
import type { TempoState } from './tempoEngine.ts';
import { ClickScheduler } from './clickScheduler.ts';
import type { PulseEvent } from './clickScheduler.ts';
import type { ClickSound, Meter, Subdivision } from '../types.ts';

const HOP = 512;

export type MicState = 'idle' | 'requesting' | 'granted' | 'denied';

interface OnsetMsg {
  type: 'onset';
  values: Float32Array;
  rms: Float32Array;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private silent: GainNode | null = null;
  private workletReady = false;

  private tracker: TempoTracker | null = null;
  scheduler: ClickScheduler | null = null;

  micState: MicState = 'idle';
  measuring = false;
  private measureMode: 'always' | 'tap' = 'always';
  private tapTimer: number | null = null;
  private currentTarget: number | null = null;

  onPulse: ((e: PulseEvent) => void) | null = null;

  getAudioTime(): number | null {
    return this.ctx ? this.ctx.currentTime : null;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  /** 사용자 제스처에서 호출. AudioContext + 마스터 게인 + 스케줄러 준비 */
  ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(ctx.destination);
    this.scheduler = new ClickScheduler(ctx, this.master);
    this.scheduler.onPulse = (e) => this.onPulse?.(e);
    this.tracker = new TempoTracker(HOP / ctx.sampleRate);
    this.tracker.setTarget(this.currentTarget);
    return ctx;
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** 마이크 권한 요청 + 워클릿 연결. 원신호 필요 → AGC/NS/EC 모두 OFF */
  async enableMic(): Promise<MicState> {
    this.ensureContext();
    if (this.workletReady && this.micState === 'granted') return 'granted';
    const ctx = this.ctx!;
    this.micState = 'requesting';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
      this.micStream = stream;
      if (!this.workletReady) {
        await ctx.audioWorklet.addModule('onset-worklet.js');
        this.workletReady = true;
      }
      this.micSource = ctx.createMediaStreamSource(stream);
      this.worklet = new AudioWorkletNode(ctx, 'onset-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      this.worklet.port.onmessage = (ev: MessageEvent) => this.onWorkletMessage(ev.data as OnsetMsg);
      // 워클릿을 그래프에 유지하기 위해 무음(게인0)으로 destination 에 연결 → 피드백 없음
      this.silent = ctx.createGain();
      this.silent.gain.value = 0;
      this.micSource.connect(this.worklet);
      this.worklet.connect(this.silent);
      this.silent.connect(ctx.destination);

      this.micState = 'granted';
      this.applyMeasuringToWorklet();
      return 'granted';
    } catch (err) {
      console.warn('마이크 사용 불가:', err);
      this.micState = 'denied';
      return 'denied';
    }
  }

  private onWorkletMessage(msg: OnsetMsg) {
    if (msg.type !== 'onset' || !this.measuring || !this.tracker) return;
    this.tracker.pushEnvelope(msg.values, msg.rms);
  }

  private applyMeasuringToWorklet() {
    this.worklet?.port.postMessage({ type: 'active', value: this.measuring });
  }

  setMeasureMode(mode: 'always' | 'tap') {
    this.measureMode = mode;
    if (mode === 'always') {
      this.measuring = this.micState === 'granted';
    } else {
      this.measuring = false;
    }
    this.applyMeasuringToWorklet();
  }

  /** 탭 측정: 몇 초간 샘플링 후 자동 종료(마지막 값 유지) */
  startTapMeasure(ms = 5000) {
    if (this.micState !== 'granted') return;
    this.tracker?.reset();
    this.measuring = true;
    this.applyMeasuringToWorklet();
    if (this.tapTimer != null) clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(() => {
      this.measuring = false;
      this.applyMeasuringToWorklet();
    }, ms) as unknown as number;
  }

  setMeasuringActive(active: boolean) {
    if (this.measureMode === 'always') this.measuring = active && this.micState === 'granted';
    this.applyMeasuringToWorklet();
  }

  setTarget(bpm: number | null) {
    this.currentTarget = bpm && bpm > 0 ? bpm : null;
    this.tracker?.setTarget(this.currentTarget);
  }

  resetDetection() {
    this.tracker?.reset();
  }

  getTempoState(): TempoState {
    return (
      this.tracker?.getState() ?? {
        detected: 0,
        rawBpm: 0,
        confidence: 0,
        stability: 0,
        stdBpm: 0,
        delta: null,
        status: 'measuring',
      }
    );
  }

  // --- 클릭 ---
  configureClick(cfg: {
    bpm?: number;
    meter?: Meter;
    clickSound?: ClickSound;
    accentBeat1?: boolean;
    subdivision?: Subdivision;
    volume?: number;
    countInBars?: number;
  }) {
    this.ensureContext();
    this.scheduler!.setConfig(cfg);
  }

  startClick() {
    this.ensureContext();
    this.scheduler!.start();
  }
  stopClick() {
    this.scheduler?.stop();
  }
  get clickRunning() {
    return this.scheduler?.isRunning ?? false;
  }

  /** 자동 인식: 몇 초 듣고 음악적 BPM 추정(프리 모드) */
  async captureTempo(ms = 4500): Promise<number | null> {
    const state = await this.enableMic();
    if (state !== 'granted' || !this.tracker) return null;
    await this.resume();
    const prevTarget = this.currentTarget;
    const prevMeasuring = this.measuring;
    this.tracker.setTarget(null);
    this.tracker.reset();
    this.measuring = true;
    this.applyMeasuringToWorklet();
    await new Promise((r) => setTimeout(r, ms));
    const bpm = this.tracker.getState().detected;
    // 복원
    this.tracker.setTarget(prevTarget);
    this.tracker.reset();
    this.measuring = prevMeasuring;
    this.applyMeasuringToWorklet();
    return bpm > 0 ? Math.round(bpm) : null;
  }

  /** 백그라운드 전환 시: 클릭 정지(측정은 유지하지 않음) */
  suspendForBackground() {
    this.stopClick();
    if (this.tapTimer != null) {
      clearTimeout(this.tapTimer);
      this.tapTimer = null;
    }
  }

  dispose() {
    this.stopClick();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.worklet?.disconnect();
    this.silent?.disconnect();
    this.micSource?.disconnect();
    this.ctx?.close();
    this.ctx = null;
    this.workletReady = false;
    this.micState = 'idle';
  }
}

export const engine = new AudioEngine();
