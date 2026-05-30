// 비트키퍼 — 테스트 파이프라인 헬퍼: PCM → OnsetDsp → 온셋 엔벨로프(+RMS)
import { OnsetDsp, DEFAULT_ONSET_CONFIG } from '../src/audio/onsetDsp.ts';
import type { OnsetConfig } from '../src/audio/onsetDsp.ts';

export interface EnvelopeResult {
  env: Float32Array;
  rms: Float32Array;
  hopTimeSec: number;
}

/** PCM 을 FRAME/HOP 으로 슬라이싱하여 OnsetDsp 로 온셋 엔벨로프 산출(워클릿과 동일 프레이밍) */
export function onsetEnvelope(
  pcm: Float32Array,
  sr = 48000,
  override: Partial<OnsetConfig> = {},
): EnvelopeResult {
  const cfg: OnsetConfig = { ...DEFAULT_ONSET_CONFIG, sampleRate: sr, ...override };
  const dsp = new OnsetDsp(cfg);
  const frame = cfg.frame;
  const hop = cfg.hop;
  const count = pcm.length >= frame ? Math.floor((pcm.length - frame) / hop) + 1 : 0;
  const env = new Float32Array(count);
  const rms = new Float32Array(count);
  let idx = 0;
  for (let start = 0; start + frame <= pcm.length; start += hop) {
    const r = dsp.processFrame(pcm.subarray(start, start + frame));
    env[idx] = r.flux;
    rms[idx] = r.rms;
    idx++;
  }
  return { env, rms, hopTimeSec: hop / sr };
}

/** 배열 합 */
export function sum(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s;
}

/** NaN/Inf 유무 */
export function allFinite(a: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}
