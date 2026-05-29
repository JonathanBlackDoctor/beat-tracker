// 비트키퍼 — 온셋 검출 AudioWorklet (브리프 §6)
// 마이크 원신호 → 1024 FFT(hop 512, 50% 오버랩) → half-wave rectified 스펙트럴 플럭스
// → 온셋 엔벨로프 값을 메인 스레드로 전달. 메인 스레드 부담을 줄이기 위해 DSP는 여기서 수행.
// 의존성 없음(자체 radix-2 FFT). 무대 대음량 대비 로그 압축 + RMS 동봉(신호 유무 판정용).

const FRAME = 1024;
const HOP = 512;

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
    this.prevMag = new Float32Array((FRAME >> 1) + 1);
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
    const bins = (n >> 1) + 1;
    let flux = 0;
    const prev = this.prevMag;
    for (let k = 0; k < bins; k++) {
      const mag = Math.log1p(Math.hypot(re[k], im[k])); // 로그 압축(대음량 클리핑 완화)
      const d = mag - prev[k];
      if (d > 0) flux += d;
      prev[k] = mag;
    }
    return { flux: flux / bins, rms };
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
