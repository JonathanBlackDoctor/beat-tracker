// 비트키퍼 — 실시간 템포 감지 엔진 (브리프 §6)
// 온셋 엔벨로프(스펙트럴 플럭스) 버퍼에 대해 자기상관 → 피크 → 후보 템포.
// 옥타브 보정(목표 스냅 / 프리 폴딩), median+EMA 스무딩, 신뢰도·안정도(분산) 산출, Δ 계산.
// 핵심 DSP는 순수 함수로 분리(단위 테스트 대상).

export interface TempoEstimate {
  /** 추정 BPM (0 = 미검출) */
  bpm: number;
  /** 0..1, 자기상관 피크의 상대 강도 */
  salience: number;
}

/** 평균 제거 후 0..maxLag 의 바이어스 보정 자기상관 */
export function autocorrelate(x: Float32Array, maxLag: number): Float32Array {
  const n = x.length;
  const ac = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    const m = n - lag;
    for (let i = 0; i < m; i++) s += x[i] * x[i + lag];
    ac[lag] = m > 0 ? s / m : 0; // 겹침 수로 정규화(작은 lag 편향 제거)
  }
  return ac;
}

function parabolicPeak(ac: Float32Array, k: number, lo: number, hi: number): number {
  if (k <= lo || k >= hi) return k;
  const a = ac[k - 1], b = ac[k], c = ac[k + 1];
  const denom = a - 2 * b + c;
  if (denom === 0) return k;
  const delta = (0.5 * (a - c)) / denom;
  return delta > -1 && delta < 1 ? k + delta : k;
}

/**
 * 온셋 엔벨로프에서 템포 추정.
 * @param env  온셋 엔벨로프 (시간순)
 * @param hopTimeSec  엔벨로프 샘플 간격(초) = hop / sampleRate
 */
export function estimateTempo(
  env: Float32Array,
  hopTimeSec: number,
  bpmMin = 40,
  bpmMax = 240,
): TempoEstimate {
  const n = env.length;
  if (n < 16) return { bpm: 0, salience: 0 };

  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n;
  const x = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    x[i] = env[i] - mean;
    energy += x[i] * x[i];
  }
  if (energy <= 1e-9) return { bpm: 0, salience: 0 };

  const lagMin = Math.max(2, Math.floor(60 / (bpmMax * hopTimeSec)));
  const lagMax = Math.min(n - 1, Math.ceil(60 / (bpmMin * hopTimeSec)));
  if (lagMax <= lagMin) return { bpm: 0, salience: 0 };

  const acMaxLag = Math.min(n - 1, lagMax * 3);
  const ac = autocorrelate(x, acMaxLag);
  const zero = ac[0];

  // 하모닉 보강 자기상관(기본 주기를 분할/배수보다 선호)
  const scores = new Float32Array(lagMax + 1);
  let maxScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let score = ac[lag];
    if (2 * lag <= acMaxLag) score += 0.5 * ac[2 * lag];
    if (3 * lag <= acMaxLag) score += 0.25 * ac[3 * lag];
    scores[lag] = score;
    if (score > maxScore) maxScore = score;
  }
  if (maxScore <= 0) return { bpm: 0, salience: 0 };

  // 1) 전역 최대 lag
  let peakLag = lagMin;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    if (scores[lag] > scores[peakLag]) peakLag = lag;
  }

  // 2) 옥타브(배수) 보정: 더 빠른 기본 주기(=더 작은 lag)에 비슷한 세기의 피크가
  //    실제로 존재하면 그쪽을 채택. 절반/1/3 BPM 오인을 lag 영역에서 반복 교정한다.
  //    (해당 빠른 펄스가 실제로 없으면 피크도 없으므로 안전.)
  // 옥타브 판정은 원시 자기상관(ac)으로 한다. 보강 점수(scores)는 비정수 격자의
  // 기본 주기를 불리하게 만들어(정수 정렬된 서브하모닉을 과대평가) 오판을 부른다.
  const windowMaxAc = (center: number): number => {
    const lo = Math.max(lagMin, Math.round(center) - 2);
    const hi = Math.min(acMaxLag, Math.round(center) + 2);
    let bl = lo;
    for (let l = lo; l <= hi; l++) if (ac[l] > ac[bl]) bl = l;
    return bl;
  };
  let bestLag = peakLag;
  for (let guard = 0; guard < 4; guard++) {
    const half = bestLag / 2;
    if (half < lagMin) break;
    const wl = windowMaxAc(half);
    if (ac[wl] >= 0.82 * ac[bestLag]) bestLag = wl;
    else break;
  }
  // 3분박(컴파운드/삼박) 서브하모닉도 1회 점검
  const third = bestLag / 3;
  if (third >= lagMin) {
    const wl = windowMaxAc(third);
    if (ac[wl] >= 0.85 * ac[bestLag]) bestLag = wl;
  }

  const lag = parabolicPeak(ac, bestLag, lagMin, lagMax);
  const bpm = 60 / (lag * hopTimeSec);
  const salience = zero > 0 ? Math.max(0, ac[bestLag] / zero) : 0;
  return { bpm, salience };
}

/**
 * 옥타브 보정.
 * - 곡 모드(target>0): target 에 가장 가까운 옥타브 배수로 스냅(절반/2배 오인 교정).
 * - 프리 모드(target<=0): 음악적 범위[freeLo, freeHi)로 폴딩.
 */
export function foldOctave(
  bpm: number,
  target: number | null,
  freeLo = 70,
  freeHi = 160,
): number {
  if (bpm <= 0) return bpm;
  if (target && target > 0) {
    const factors = [0.25, 1 / 3, 0.5, 1, 2, 3, 4];
    let best = bpm;
    let bestErr = Infinity;
    for (const f of factors) {
      const c = bpm * f;
      const err = Math.abs(c - target);
      if (err < bestErr) {
        bestErr = err;
        best = c;
      }
    }
    return best;
  }
  let b = bpm;
  for (let i = 0; i < 4 && b < freeLo; i++) b *= 2;
  for (let i = 0; i < 4 && b >= freeHi; i++) b /= 2;
  return b;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type DetectStatus = 'measuring' | 'no-signal' | 'ok';

export interface TempoState {
  detected: number; // 스무딩된 표시 BPM
  rawBpm: number; // 최신 원시 추정
  confidence: number; // 0..1
  stability: number; // 0..1 (높을수록 안정)
  stdBpm: number; // 최근 BPM 표준편차
  delta: number | null; // detected - target (target 없으면 null)
  status: DetectStatus;
}

const BUFFER_SECONDS = 6;
const RECOMPUTE_EVERY = 8; // 약 ~85ms 마다 재계산
const HISTORY = 8; // 스무딩/안정도 창
const SILENCE_RMS = 0.002; // 이 이하 평균 RMS → 신호 없음
const CONF_MIN = 0.12; // 이 이상 salience → 락온
const EMA_ALPHA = 0.35;
const STAB_FULL = 6; // std 6BPM 이상이면 안정도 0

/**
 * 상태를 보유한 실시간 템포 추적기. 워클릿이 보낸 온셋 엔벨로프를 push 하면
 * 내부 버퍼를 갱신하며 주기적으로 추정값을 재계산한다.
 */
export class TempoTracker {
  private hopTimeSec: number;
  private buf: Float32Array;
  private len = 0;
  private newSince = 0;
  private rmsAvg = 0;
  private target: number | null = null;

  private rawHist: number[] = [];
  private emaBpm = 0;

  private state: TempoState = {
    detected: 0,
    rawBpm: 0,
    confidence: 0,
    stability: 0,
    stdBpm: 0,
    delta: null,
    status: 'measuring',
  };

  constructor(hopTimeSec: number) {
    this.hopTimeSec = hopTimeSec;
    const n = Math.ceil(BUFFER_SECONDS / hopTimeSec);
    this.buf = new Float32Array(n);
  }

  setTarget(bpm: number | null) {
    this.target = bpm && bpm > 0 ? bpm : null;
  }

  reset() {
    this.len = 0;
    this.newSince = 0;
    this.rmsAvg = 0;
    this.rawHist = [];
    this.emaBpm = 0;
    this.state = {
      detected: 0,
      rawBpm: 0,
      confidence: 0,
      stability: 0,
      stdBpm: 0,
      delta: null,
      status: 'measuring',
    };
  }

  /** 워클릿 온셋 값(+RMS) 추가 */
  pushEnvelope(values: Float32Array, rms?: Float32Array) {
    const cap = this.buf.length;
    for (let i = 0; i < values.length; i++) {
      if (this.len < cap) {
        this.buf[this.len++] = values[i];
      } else {
        this.buf.copyWithin(0, 1);
        this.buf[cap - 1] = values[i];
      }
      if (rms) this.rmsAvg = this.rmsAvg * 0.95 + rms[i] * 0.05;
      this.newSince++;
    }
    if (this.newSince >= RECOMPUTE_EVERY) {
      this.newSince = 0;
      this.recompute();
    }
  }

  private recompute() {
    const view = this.buf.subarray(0, this.len);
    const minSamples = Math.ceil(2.5 / this.hopTimeSec); // 락온 전 최소 ~2.5초

    if (this.rmsAvg < SILENCE_RMS) {
      this.state.status = 'no-signal';
      this.state.confidence = 0;
      return;
    }

    const est = estimateTempo(view, this.hopTimeSec);
    const conf = Math.min(1, Math.max(0, (est.salience - 0.05) / (0.45 - 0.05)));

    if (this.len < minSamples || est.bpm <= 0 || est.salience < CONF_MIN) {
      this.state.status = 'measuring';
      this.state.confidence = conf;
      return;
    }

    const folded = foldOctave(est.bpm, this.target);
    this.state.rawBpm = folded;

    // median 필터 → EMA
    this.rawHist.push(folded);
    if (this.rawHist.length > HISTORY) this.rawHist.shift();
    const med = median(this.rawHist);
    this.emaBpm = this.emaBpm > 0 ? this.emaBpm + EMA_ALPHA * (med - this.emaBpm) : med;

    // 안정도(최근 원시 분산)
    const h = this.rawHist;
    let mu = 0;
    for (const v of h) mu += v;
    mu /= h.length;
    let varr = 0;
    for (const v of h) varr += (v - mu) * (v - mu);
    const std = Math.sqrt(varr / h.length);

    this.state.detected = this.emaBpm;
    this.state.confidence = conf;
    this.state.stdBpm = std;
    this.state.stability = Math.min(1, Math.max(0, 1 - std / STAB_FULL));
    this.state.delta = this.target != null ? this.emaBpm - this.target : null;
    this.state.status = 'ok';
  }

  getState(): TempoState {
    return this.state;
  }
}
