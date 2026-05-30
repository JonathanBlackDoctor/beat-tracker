// 비트키퍼 — 온셋 검출 AudioWorklet (브리프 §6)
// ⚠️ 이 파일은 src/audio/onsetDsp.ts 의 수기 미러다. 상수·알고리즘을 lockstep 으로 유지할 것
//    (tests/onsetParity.test.ts 가 상수 일치를 강제한다). 입력 소스만 다르다:
//    여기서는 입력 샘플 링버퍼에서 최신 FRAME 샘플을 읽고, onsetDsp 는 연속 프레임을 받는다.
//
// 마이크 원신호 → 1024 FFT(hop 512, 50% 오버랩) → 멜 필터뱅크(~30밴드) → 대역별 적응 화이트닝
//   → SuperFlux(직전 프레임 주파수 max-filter 후 차분 → 비브라토/지속음 억제) → 타악 대역가중 합
//   = 온셋 강도. RMS 동봉(신호 유무 판정). 의존성 없음(자체 radix-2 FFT). 핫패스 무할당.

const FRAME = 1024;
const HOP = 512;
const NUM_BANDS = 30;
const F_LO = 40;
const F_HI = 16000;
const WHITEN_TAU = 0.5; // 화이트닝 피크 추종 시정수(초)
const WHITEN_FLOOR = 1e-4; // 화이트닝 분모 최소값
const MAX_FILTER_RADIUS = 4; // SuperFlux 주파수 max-filter 반경(밴드)
const MU = 1; // SuperFlux 프레임 지연

class FFT {
  constructor(n) {
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
      let x = i, r = 0;
      for (let j = 0; j < bits; j++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.rev[i] = r >>> 0;
    }
  }
  // in-place 복소 FFT
  transform(re, im) {
    const n = this.n, rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const tw = k * step;
          const c = this.cos[tw], s = this.sin[tw];
          const a = i + k, b = a + half;
          const tre = re[b] * c - im[b] * s;
          const tim = re[b] * s + im[b] * c;
          re[b] = re[a] - tre; im[b] = im[a] - tim;
          re[a] += tre; im[a] += tim;
        }
      }
    }
  }
}

// --- 멜 필터뱅크 (onsetDsp.ts 미러) ---
function hzToMel(f) {
  return 2595 * Math.log10(1 + f / 700);
}
function melToHz(m) {
  return 700 * (Math.pow(10, m / 2595) - 1);
}
// 타악 핵심(킥/스네어) 강조, 하이햇 완만, 12kHz↑ 롤오프 (onsetDsp.perceptualBandWeight 와 동일)
function perceptualBandWeight(hz) {
  let w;
  if (hz < 60) w = 0.6 + 0.4 * (hz / 60);
  else if (hz <= 800) w = 1.0;
  else if (hz <= 4000) w = 1.0 - 0.35 * ((hz - 800) / 3200);
  else if (hz <= 12000) w = 0.65 - 0.35 * ((hz - 4000) / 8000);
  else w = 0.3 * Math.max(0, 1 - (hz - 12000) / 8000);
  return w < 0 ? 0 : w;
}
function buildMelFilterBank(fftSize, sr, numBands, fLo, fHi) {
  const nBins = (fftSize >> 1) + 1;
  const melLo = hzToMel(fLo), melHi = hzToMel(fHi);
  const pts = new Float32Array(numBands + 2);
  for (let i = 0; i < numBands + 2; i++) {
    const mel = melLo + ((melHi - melLo) * i) / (numBands + 1);
    pts[i] = (melToHz(mel) * fftSize) / sr;
  }
  const starts = new Int32Array(numBands);
  const ends = new Int32Array(numBands);
  const offsets = new Int32Array(numBands);
  const bandWeight = new Float32Array(numBands);
  const wlist = [];
  for (let b = 0; b < numBands; b++) {
    const left = pts[b], center = pts[b + 1], right = pts[b + 2];
    let lo = Math.floor(left); if (lo < 0) lo = 0;
    let hi = Math.ceil(right); if (hi > nBins - 1) hi = nBins - 1; if (hi < lo) hi = lo;
    offsets[b] = wlist.length;
    starts[b] = lo;
    ends[b] = hi + 1;
    for (let k = lo; k <= hi; k++) {
      let w = 0;
      if (center > left && k >= left && k <= center) w = (k - left) / (center - left);
      else if (right > center && k > center && k <= right) w = (right - k) / (right - center);
      wlist.push(w > 0 ? w : 0);
    }
    bandWeight[b] = perceptualBandWeight((center * sr) / fftSize);
  }
  return { numBands, starts, ends, offsets, weights: new Float32Array(wlist), bandWeight };
}

class OnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fft = new FFT(FRAME);
    // 입력 누적 링버퍼(최근 FRAME 샘플)
    this.ring = new Float32Array(FRAME);
    this.ringPos = 0;
    this.filled = 0;
    this.sinceHop = 0;
    // 작업 버퍼(사전 할당 — 프레임마다 할당 회피)
    this.re = new Float32Array(FRAME);
    this.im = new Float32Array(FRAME);
    this.window = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)); // Hann
    }
    this.mag = new Float32Array((FRAME >> 1) + 1);
    // 멜/화이트닝/SuperFlux 상태
    this.fb = buildMelFilterBank(FRAME, sampleRate, NUM_BANDS, F_LO, F_HI);
    this.band = new Float32Array(NUM_BANDS);
    this.peak = new Float32Array(NUM_BANDS).fill(WHITEN_FLOOR);
    this.ringSlots = MU + 1;
    this.specRing = new Float32Array(this.ringSlots * NUM_BANDS);
    this.writeIdx = 0;
    this.frameCount = 0;
    this.whitenDecay = Math.exp(-HOP / sampleRate / WHITEN_TAU);
    // 전송 버퍼
    this.outOnset = new Float32Array(32);
    this.outRms = new Float32Array(32);
    this.outCount = 0;
    this.active = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'active') this.active = e.data.value;
    };
  }

  computeFrame() {
    const re = this.re, im = this.im, win = this.window;
    const ring = this.ring, n = FRAME;
    // 가장 오래된 → 최신 순으로 읽어 윈도잉
    let rms = 0;
    for (let i = 0; i < n; i++) {
      const s = ring[(this.ringPos + i) % n];
      rms += s * s;
      re[i] = s * win[i];
      im[i] = 0;
    }
    rms = Math.sqrt(rms / n);
    this.fft.transform(re, im);
    const nBins = (n >> 1) + 1;
    const mag = this.mag;
    for (let k = 0; k < nBins; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);

    // 멜 필터뱅크
    const fb = this.fb, band = this.band;
    for (let b = 0; b < NUM_BANDS; b++) {
      let s = 0, wi = fb.offsets[b];
      const end = fb.ends[b];
      for (let kk = fb.starts[b]; kk < end; kk++) s += mag[kk] * fb.weights[wi++];
      band[b] = s;
    }

    // 대역별 적응 화이트닝 → 현재 스펙트럼 링 슬롯
    const peak = this.peak, decay = this.whitenDecay, sring = this.specRing;
    const base = this.writeIdx * NUM_BANDS;
    for (let b = 0; b < NUM_BANDS; b++) {
      let p = peak[b] * decay;
      if (band[b] > p) p = band[b];
      if (p < WHITEN_FLOOR) p = WHITEN_FLOOR;
      peak[b] = p;
      sring[base + b] = band[b] / p;
    }

    // SuperFlux: 참조(t−MU) 스펙트럼을 ±radius 밴드로 max-filter 후 차분
    let flux = 0;
    if (this.frameCount >= MU) {
      const bw = fb.bandWeight;
      const refBase = ((this.writeIdx - MU + this.ringSlots) % this.ringSlots) * NUM_BANDS;
      for (let b = 0; b < NUM_BANDS; b++) {
        let lo = b - MAX_FILTER_RADIUS; if (lo < 0) lo = 0;
        let hi = b + MAX_FILTER_RADIUS; if (hi > NUM_BANDS - 1) hi = NUM_BANDS - 1;
        let m = sring[refBase + lo];
        for (let j = lo + 1; j <= hi; j++) {
          const v = sring[refBase + j];
          if (v > m) m = v;
        }
        const d = sring[base + b] - m;
        if (d > 0) flux += bw[b] * d;
      }
      flux /= NUM_BANDS;
    }

    this.writeIdx = (this.writeIdx + 1) % this.ringSlots;
    this.frameCount++;
    return { flux, rms };
  }

  process(inputs) {
    const input = inputs[0];
    if (!this.active || !input || input.length === 0) return true;
    const ch = input[0];
    if (!ch) return true;
    const n = FRAME;
    for (let i = 0; i < ch.length; i++) {
      this.ring[this.ringPos] = ch[i];
      this.ringPos = (this.ringPos + 1) % n;
      if (this.filled < n) this.filled++;
      this.sinceHop++;
      if (this.filled >= n && this.sinceHop >= HOP) {
        this.sinceHop = 0;
        const { flux, rms } = this.computeFrame();
        if (this.outCount < this.outOnset.length) {
          this.outOnset[this.outCount] = flux;
          this.outRms[this.outCount] = rms;
          this.outCount++;
        }
      }
    }
    // 4프레임(~40ms) 모이면 일괄 전송 → 메시지 오버헤드 감소
    if (this.outCount >= 4) {
      this.port.postMessage({
        type: 'onset',
        values: this.outOnset.slice(0, this.outCount),
        rms: this.outRms.slice(0, this.outCount),
      });
      this.outCount = 0;
    }
    return true;
  }
}

registerProcessor('onset-processor', OnsetProcessor);
