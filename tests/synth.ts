// 비트키퍼 — 테스트용 결정론적 오디오 합성기
// 실측 마이크 없이 온셋→템포 파이프라인을 검증하기 위해 드럼 패턴 PCM(48kHz mono)을 합성한다.
// 킥(저역 감쇠 사인) 1·3박, 스네어(필터 노이즈+바디) 2·4박, 하이햇(고역 노이즈) 8분.

/** 결정적 PRNG → [0,1) */
export function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** 저역 감쇠 사인(약간의 피치 드롭) — 킥 */
export function addKick(buf: Float32Array, start: number, sr: number, gain = 1): void {
  const f0 = 58;
  const decay = 0.09;
  const len = Math.floor(decay * 3 * sr);
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / sr;
    const env = Math.exp(-t / decay);
    const f = f0 * (1 + 0.6 * Math.exp(-t / 0.02)); // 어택에서 피치 살짝 하강
    buf[start + i] += gain * env * Math.sin(2 * Math.PI * f * t);
  }
}

/** 필터 노이즈 + 200Hz 바디 — 스네어 */
export function addSnare(
  buf: Float32Array,
  start: number,
  sr: number,
  rng: () => number,
  gain = 1,
): void {
  const decay = 0.12;
  const len = Math.floor(decay * 3 * sr);
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / sr;
    const env = Math.exp(-t / decay);
    const noise = rng() * 2 - 1;
    const body = Math.sin(2 * Math.PI * 200 * t) * 0.5;
    buf[start + i] += gain * env * (0.7 * noise + 0.3 * body);
  }
}

/** 고역(차분 노이즈) 단발 — 하이햇 */
export function addHat(
  buf: Float32Array,
  start: number,
  sr: number,
  rng: () => number,
  gain = 0.5,
): void {
  const decay = 0.03;
  const len = Math.floor(decay * 3 * sr);
  let prev = 0;
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / sr;
    const env = Math.exp(-t / decay);
    const noise = rng() * 2 - 1;
    const hp = noise - prev;
    prev = noise;
    buf[start + i] += gain * env * hp;
  }
}

export interface PatternOpts {
  sr?: number;
  swing?: number; // 0..0.5, 오프비트 8분 지연(셔플)
  dropKick?: number; // 0..1, 킥 누락 확률(싱코페이션/다운비트 누락)
  hatGain?: number;
  kickGain?: number;
  snareGain?: number;
  seed?: number;
  noise?: number; // 절대 화이트 노이즈 진폭
}

/** 백비트 4/4: 킥 1·3, 스네어 2·4, 하이햇 8분 */
export function synthBackbeat(bpm: number, seconds: number, opts: PatternOpts = {}): Float32Array {
  const sr = opts.sr ?? 48000;
  const swing = opts.swing ?? 0;
  const dropKick = opts.dropKick ?? 0;
  const hatGain = opts.hatGain ?? 0.5;
  const kickGain = opts.kickGain ?? 1;
  const snareGain = opts.snareGain ?? 0.9;
  const n = Math.floor(seconds * sr);
  const buf = new Float32Array(n);
  const rng = makePrng(opts.seed ?? 0x1234);
  const noiseRng = makePrng((opts.seed ?? 0x1234) ^ 0x9e3779b9);
  const eighth = 30 / bpm; // 초/8분
  for (let e = 0; ; e++) {
    let t = e * eighth;
    if (e % 2 === 1 && swing > 0) t += swing * eighth;
    const start = Math.round(t * sr);
    if (start >= n) break;
    if (e % 2 === 0) {
      const q = (e / 2) % 4;
      if (q === 0 || q === 2) {
        if (!(dropKick > 0 && rng() < dropKick)) addKick(buf, start, sr, kickGain);
      } else {
        addSnare(buf, start, sr, rng, snareGain);
      }
    }
    addHat(buf, start, sr, rng, hatGain);
  }
  if (opts.noise && opts.noise > 0) {
    const a = opts.noise;
    for (let i = 0; i < n; i++) buf[i] += (noiseRng() * 2 - 1) * a;
  }
  return buf;
}

/** 단순 피드백 콤 잔향(방 울림 모사) */
export function addReverb(buf: Float32Array, sr: number, decaySec = 0.3, mix = 0.4): Float32Array {
  const d = Math.floor(0.029 * sr);
  const g = Math.exp(-0.029 / decaySec);
  const wet = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    let v = buf[i];
    if (i >= d) v += g * wet[i - d];
    wet[i] = v;
  }
  for (let i = 0; i < buf.length; i++) buf[i] = (1 - mix) * buf[i] + mix * wet[i];
  return buf;
}

/** 신호 RMS 기준으로 목표 SNR(dB)에 맞춰 화이트 노이즈 추가 */
export function addNoiseAtSnr(buf: Float32Array, snrDb: number, seed = 0x55aa): Float32Array {
  let e = 0;
  for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
  const sigRms = Math.sqrt(e / buf.length);
  const noiseRms = sigRms / Math.pow(10, snrDb / 20);
  const rng = makePrng(seed);
  const amp = noiseRms * Math.sqrt(3); // 균등분포 [-amp,amp] 의 RMS = amp/sqrt(3)
  for (let i = 0; i < buf.length; i++) buf[i] += (rng() * 2 - 1) * amp;
  return buf;
}

/** 하드 클리핑(과대 입력/무대 대음량 모사) */
export function hardClip(buf: Float32Array, level = 1): Float32Array {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] > level) buf[i] = level;
    else if (buf[i] < -level) buf[i] = -level;
  }
  return buf;
}

/** 선형 템포 램프 후 유지 — 드리프트 추종 검증용 */
export function synthRamp(
  bpmStart: number,
  bpmEnd: number,
  rampSec: number,
  holdSec: number,
  opts: PatternOpts = {},
): Float32Array {
  const sr = opts.sr ?? 48000;
  const hatGain = opts.hatGain ?? 0.5;
  const kickGain = opts.kickGain ?? 1;
  const snareGain = opts.snareGain ?? 0.9;
  const total = rampSec + holdSec;
  const n = Math.floor(total * sr);
  const buf = new Float32Array(n);
  const rng = makePrng(opts.seed ?? 0x2222);
  let t = 0;
  for (let e = 0; t < total; e++) {
    const frac = t < rampSec ? t / rampSec : 1;
    const bpm = bpmStart + (bpmEnd - bpmStart) * frac;
    const start = Math.round(t * sr);
    if (start >= n) break;
    if (e % 2 === 0) {
      const q = (e / 2) % 4;
      if (q === 0 || q === 2) addKick(buf, start, sr, kickGain);
      else addSnare(buf, start, sr, rng, snareGain);
    }
    addHat(buf, start, sr, rng, hatGain);
    t += 30 / bpm;
  }
  return buf;
}

/** 진폭 변조(비브라토 모사) 지속 톤 — SuperFlux 비브라토 억제 검증용 */
export function addVibratoTone(
  buf: Float32Array,
  sr: number,
  carrierHz = 440,
  vibratoHz = 6,
  depth = 0.02,
  gain = 0.5,
): Float32Array {
  let phase = 0;
  for (let i = 0; i < buf.length; i++) {
    const t = i / sr;
    const f = carrierHz * (1 + depth * Math.sin(2 * Math.PI * vibratoHz * t));
    phase += (2 * Math.PI * f) / sr;
    buf[i] += gain * Math.sin(phase);
  }
  return buf;
}
