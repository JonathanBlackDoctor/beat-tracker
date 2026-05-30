// 비트키퍼 — 온셋 검출 DSP (순수 모듈, 단일 진실원)
// public/onset-worklet.js 가 이 알고리즘을 그대로 미러한다(상수 lockstep — tests/onsetParity.test.ts 가 강제).
//
// 파이프라인(전문가급 온셋 강도):
//   1024 FFT(hop 512) → 멜 필터뱅크(513빈→~30밴드) → 대역별 적응 화이트닝(무대 대음량·클리핑 불변)
//   → SuperFlux(Böck & Widmer 2013: 직전 프레임을 주파수 max-filter 후 차분 → 비브라토/지속음 억제)
//   → 타악 대역가중 합 = 온셋 강도(flux). RMS 동봉(신호 유무 판정용).
//
// 핫패스 무할당: 모든 작업 버퍼는 생성자에서 사전할당한다(연주 중 GC 멈춤 금지 — 브리프 §9).

/** in-place radix-2 복소 FFT (onset-worklet.js 의 FFT 와 동일 수학) */
export class FFT {
  readonly n: number;
  private cos: Float32Array;
  private sin: Float32Array;
  private rev: Uint32Array;

  constructor(n: number) {
    this.n = n;
    this.cos = new Float32Array(n >> 1);
    this.sin = new Float32Array(n >> 1);
    for (let i = 0; i < n >> 1; i++) {
      const a = (-2 * Math.PI * i) / n;
      this.cos[i] = Math.cos(a);
      this.sin[i] = Math.sin(a);
    }
    this.rev = new Uint32Array(n);
    let bits = 0;
    while (1 << bits < n) bits++;
    for (let i = 0; i < n; i++) {
      let x = i;
      let r = 0;
      for (let j = 0; j < bits; j++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.rev[i] = r >>> 0;
    }
  }

  transform(re: Float32Array, im: Float32Array): void {
    const n = this.n;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const tw = k * step;
          const c = this.cos[tw];
          const s = this.sin[tw];
          const a = i + k;
          const b = a + half;
          const tre = re[b] * c - im[b] * s;
          const tim = re[b] * s + im[b] * c;
          re[b] = re[a] - tre;
          im[b] = im[a] - tim;
          re[a] += tre;
          im[a] += tim;
        }
      }
    }
  }
}

/** 멜 ↔ Hz */
function hzToMel(f: number): number {
  return 2595 * Math.log10(1 + f / 700);
}
function melToHz(m: number): number {
  return 700 * (Math.pow(10, m / 2595) - 1);
}

/**
 * 지각적 대역 가중치. 타악 핵심(킥 ~50–250Hz, 스네어 ~150–800Hz)을 강조하고,
 * 하이햇/심벌(2–8kHz)은 8분 그리드의 신뢰 소스이므로 0으로 만들지 않고 완만히,
 * 12kHz 이상 심벌 워시/지속음은 롤오프. (폰 마이크 저역 롤오프 고려 → 초저역도 과가중 금지.)
 */
export function perceptualBandWeight(hz: number): number {
  let w: number;
  if (hz < 60) w = 0.6 + 0.4 * (hz / 60); // 초저역: 럼블/마이크 롤오프 → 약간 감쇠
  else if (hz <= 800) w = 1.0; // 킥+스네어 코어: 최대
  else if (hz <= 4000) w = 1.0 - 0.35 * ((hz - 800) / 3200); // 4k 에서 0.65 로 테이퍼
  else if (hz <= 12000) w = 0.65 - 0.35 * ((hz - 4000) / 8000); // 12k 에서 0.30 으로 테이퍼
  else w = 0.3 * Math.max(0, 1 - (hz - 12000) / 8000); // 20k 에서 0 으로 롤오프
  return w < 0 ? 0 : w;
}

/** 삼각 멜 필터뱅크(희소 저장 — 핫패스 무할당 적용용) */
export interface FilterBank {
  numBands: number;
  /** 각 밴드의 시작 빈(포함) */
  starts: Int32Array;
  /** 각 밴드의 끝 빈(제외) */
  ends: Int32Array;
  /** weights 안에서 각 밴드 가중치가 시작하는 오프셋 */
  offsets: Int32Array;
  /** 밴드 순서대로 평탄화된 삼각 가중치 */
  weights: Float32Array;
  /** 밴드별 지각 가중치 */
  bandWeight: Float32Array;
  /** 밴드 중심 주파수(Hz) — 디버그/검증용 */
  centerHz: Float32Array;
}

export function makeMelFilterBank(
  fftSize: number,
  sampleRate: number,
  numBands: number,
  fLo: number,
  fHi: number,
): FilterBank {
  const nBins = (fftSize >> 1) + 1;
  const melLo = hzToMel(fLo);
  const melHi = hzToMel(fHi);
  // numBands+2 개의 멜 등간격 경계점을 빈 좌표(분수)로 변환
  const pts = new Float32Array(numBands + 2);
  for (let i = 0; i < numBands + 2; i++) {
    const mel = melLo + ((melHi - melLo) * i) / (numBands + 1);
    pts[i] = (melToHz(mel) * fftSize) / sampleRate;
  }
  const starts = new Int32Array(numBands);
  const ends = new Int32Array(numBands);
  const offsets = new Int32Array(numBands);
  const centerHz = new Float32Array(numBands);
  const bandWeight = new Float32Array(numBands);
  const wlist: number[] = [];
  for (let b = 0; b < numBands; b++) {
    const left = pts[b];
    const center = pts[b + 1];
    const right = pts[b + 2];
    let lo = Math.floor(left);
    if (lo < 0) lo = 0;
    let hi = Math.ceil(right);
    if (hi > nBins - 1) hi = nBins - 1;
    if (hi < lo) hi = lo;
    offsets[b] = wlist.length;
    starts[b] = lo;
    ends[b] = hi + 1;
    for (let k = lo; k <= hi; k++) {
      let w = 0;
      if (center > left && k >= left && k <= center) w = (k - left) / (center - left);
      else if (right > center && k > center && k <= right) w = (right - k) / (right - center);
      wlist.push(w > 0 ? w : 0);
    }
    centerHz[b] = (center * sampleRate) / fftSize;
    bandWeight[b] = perceptualBandWeight(centerHz[b]);
  }
  return {
    numBands,
    starts,
    ends,
    offsets,
    weights: new Float32Array(wlist),
    bandWeight,
    centerHz,
  };
}

/** 자기 magnitude 스펙트럼에 필터뱅크 적용 → 밴드 에너지(out 에 기록) */
export function applyFilterBank(mag: Float32Array, fb: FilterBank, out: Float32Array): void {
  for (let b = 0; b < fb.numBands; b++) {
    let s = 0;
    let wi = fb.offsets[b];
    const end = fb.ends[b];
    for (let k = fb.starts[b]; k < end; k++) s += mag[k] * fb.weights[wi++];
    out[b] = s;
  }
}

export interface OnsetConfig {
  frame: number;
  hop: number;
  sampleRate: number;
  numBands: number;
  fLo: number;
  fHi: number;
  /** 적응 화이트닝 피크 추종 시정수(초) */
  whitenTauSec: number;
  /** 화이트닝 분모 최소값(0 나눗셈 방지) */
  whitenFloor: number;
  /** SuperFlux 주파수 max-filter 반경(밴드) */
  maxFilterRadius: number;
  /** SuperFlux 프레임 지연(μ) */
  mu: number;
}

// ⚠️ 이 상수들은 public/onset-worklet.js 와 lockstep 유지(onsetParity 테스트).
export const DEFAULT_ONSET_CONFIG: OnsetConfig = {
  frame: 1024,
  hop: 512,
  sampleRate: 48000,
  numBands: 30,
  fLo: 40,
  fHi: 16000,
  whitenTauSec: 0.5,
  whitenFloor: 1e-4,
  maxFilterRadius: 4,
  mu: 1,
};

export interface OnsetFrameResult {
  flux: number;
  rms: number;
}

/**
 * 스트림당 1 인스턴스. 연속한(시간순) 시간영역 프레임(길이 frame)을 받아
 * 온셋 강도 + RMS 를 반환. 내부 상태(화이트닝 피크, SuperFlux 스펙트럼 링)는 프레임 간 유지.
 */
export class OnsetDsp {
  readonly cfg: OnsetConfig;
  private fft: FFT;
  private fb: FilterBank;
  private window: Float32Array;
  private re: Float32Array;
  private im: Float32Array;
  private mag: Float32Array;
  private band: Float32Array;
  private peak: Float32Array; // 대역별 화이트닝 피크
  private specRing: Float32Array; // (mu+1) × numBands 화이트닝 스펙트럼 링
  private ringSlots: number;
  private writeIdx = 0;
  private frameCount = 0;
  private whitenDecay: number;

  constructor(cfg: OnsetConfig = DEFAULT_ONSET_CONFIG) {
    this.cfg = cfg;
    const { frame, numBands } = cfg;
    this.fft = new FFT(frame);
    this.fb = makeMelFilterBank(frame, cfg.sampleRate, numBands, cfg.fLo, cfg.fHi);
    this.window = new Float32Array(frame);
    for (let i = 0; i < frame; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1)); // Hann
    }
    this.re = new Float32Array(frame);
    this.im = new Float32Array(frame);
    this.mag = new Float32Array((frame >> 1) + 1);
    this.band = new Float32Array(numBands);
    this.peak = new Float32Array(numBands).fill(cfg.whitenFloor);
    this.ringSlots = cfg.mu + 1;
    this.specRing = new Float32Array(this.ringSlots * numBands);
    this.whitenDecay = Math.exp(-cfg.hop / cfg.sampleRate / cfg.whitenTauSec);
  }

  reset(): void {
    this.writeIdx = 0;
    this.frameCount = 0;
    this.peak.fill(this.cfg.whitenFloor);
    this.specRing.fill(0);
  }

  /** 시간순 프레임(길이 frame) → { flux, rms } */
  processFrame(frame: Float32Array): OnsetFrameResult {
    const n = this.cfg.frame;
    const re = this.re;
    const im = this.im;
    const win = this.window;
    let rms = 0;
    for (let i = 0; i < n; i++) {
      const s = frame[i];
      rms += s * s;
      re[i] = s * win[i];
      im[i] = 0;
    }
    rms = Math.sqrt(rms / n);
    this.fft.transform(re, im);
    const nBins = this.mag.length;
    const mag = this.mag;
    for (let k = 0; k < nBins; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);

    const fb = this.fb;
    const band = this.band;
    applyFilterBank(mag, fb, band);

    // 대역별 적응 화이트닝 → 현재 링 슬롯
    const nb = this.cfg.numBands;
    const peak = this.peak;
    const decay = this.whitenDecay;
    const floor = this.cfg.whitenFloor;
    const base = this.writeIdx * nb;
    const ring = this.specRing;
    for (let b = 0; b < nb; b++) {
      let p = peak[b] * decay;
      if (band[b] > p) p = band[b];
      if (p < floor) p = floor;
      peak[b] = p;
      ring[base + b] = band[b] / p; // [0,1]
    }

    // SuperFlux: 참조(t−mu) 스펙트럼을 ±radius 밴드로 max-filter 후 차분
    let flux = 0;
    const mu = this.cfg.mu;
    if (this.frameCount >= mu) {
      const radius = this.cfg.maxFilterRadius;
      const bw = fb.bandWeight;
      const refBase = ((this.writeIdx - mu + this.ringSlots) % this.ringSlots) * nb;
      for (let b = 0; b < nb; b++) {
        let lo = b - radius;
        if (lo < 0) lo = 0;
        let hi = b + radius;
        if (hi > nb - 1) hi = nb - 1;
        let m = ring[refBase + lo];
        for (let j = lo + 1; j <= hi; j++) {
          const v = ring[refBase + j];
          if (v > m) m = v;
        }
        const d = ring[base + b] - m;
        if (d > 0) flux += bw[b] * d;
      }
      flux /= nb;
    }

    this.writeIdx = (this.writeIdx + 1) % this.ringSlots;
    this.frameCount++;
    return { flux, rms };
  }
}
