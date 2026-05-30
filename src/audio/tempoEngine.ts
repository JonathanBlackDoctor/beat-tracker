// 비트키퍼 — 실시간 템포 감지 엔진 (브리프 §6)
// 온셋 엔벨로프(스펙트럴 플럭스) 버퍼에 대해:
//   적응 지역평균 하이패스 + 정류 → 자기상관(ACF) 콤 점수 × 푸리에 템포그램 × 옥타브 prior
//   → 피크 → 후보 템포. ACF(서브하모닉 과대)·푸리에(슈퍼하모닉 과대)의 곱이 기본 주기를 날카롭게
//   하고 옥타브 유령을 상쇄한다(librosa.beat.tempo 설계와 동일). prior 는 옥타브비 기준 로그정규.
// 추적기는 비대칭 히스테리시스(옥타브 점프만 지속 요구, 작은 드리프트는 즉시 반영) +
//   신뢰도 가중 EMA + 적응 노이즈 게이트. 핵심 DSP 는 순수 함수로 분리(단위 테스트 대상).

export interface TempoEstimate {
  /** 추정 BPM (0 = 미검출) */
  bpm: number;
  /** 0..1, 결합 점수 피크의 돌출도(prominence). 신뢰도 산출에 사용 */
  salience: number;
}

/** 0..maxLag 의 바이어스 보정 자기상관(겹침 수로 정규화). 입력은 호출 측에서 평균 제거. */
export function autocorrelate(x: Float32Array, maxLag: number): Float32Array {
  const n = x.length;
  const ac = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    const m = n - lag;
    for (let i = 0; i < m; i++) s += x[i] * x[i + lag];
    ac[lag] = m > 0 ? s / m : 0;
  }
  return ac;
}

function parabolicPeak(arr: Float32Array, k: number, lo: number, hi: number): number {
  if (k <= lo || k >= hi) return k;
  const a = arr[k - 1];
  const b = arr[k];
  const c = arr[k + 1];
  const denom = a - 2 * b + c;
  if (denom === 0) return k;
  const delta = (0.5 * (a - c)) / denom;
  return delta > -1 && delta < 1 ? k + delta : k;
}

/**
 * 적응 지역평균 하이패스 + half-wave 정류(향상된 온셋 엔벨로프).
 * 느린 에너지 드리프트를 제거하고, 지역 평균 위로 솟은 온셋만 남긴다(적응 임계화).
 * @param win  지역평균 창 크기(샘플). ~0.4–0.5s / hopTimeSec 권장.
 */
export function enhanceEnvelope(env: Float32Array, win: number, out?: Float32Array): Float32Array {
  const n = env.length;
  const res = out && out.length >= n ? out : new Float32Array(n);
  let half = win >> 1;
  if (half < 1) half = 1;
  // 중심 슬라이딩 창 running-sum (O(n), 무할당)
  let sum = 0;
  let lo = 0;
  let hi = -1;
  const first = half < n ? half : n - 1;
  for (let i = 0; i <= first; i++) sum += env[i];
  hi = first;
  for (let i = 0; i < n; i++) {
    const newHi = i + half < n - 1 ? i + half : n - 1;
    while (hi < newHi) sum += env[++hi];
    const newLo = i - half > 0 ? i - half : 0;
    while (lo < newLo) sum -= env[lo++];
    const mean = sum / (hi - lo + 1);
    const v = env[i] - mean;
    res[i] = v > 0 ? v : 0;
  }
  return res;
}

/** 푸리에 템포그램 단일 빈 magnitude (위상자 점화식 — bpm 당 trig 2회). */
export function tempogramBin(x: Float32Array, hopTimeSec: number, bpm: number): number {
  const n = x.length;
  const w = 2 * Math.PI * (bpm / 60) * hopTimeSec; // 샘플당 라디안
  const c = Math.cos(w);
  const s = Math.sin(w);
  let cosA = 1;
  let sinA = 0;
  let re = 0;
  let im = 0;
  for (let t = 0; t < n; t++) {
    const v = x[t];
    re += v * cosA;
    im += v * sinA;
    const nc = cosA * c - sinA * s;
    sinA = sinA * c + cosA * s;
    cosA = nc;
  }
  return Math.sqrt(re * re + im * im) / n;
}

/** 옥타브비 기준 로그정규 prior(0..1). center 에서 ±소량 드리프트는 거의 무패널티, 0.5×/2× 만 억제. */
export function tempoPrior(bpm: number, center: number, octaveStd: number): number {
  if (bpm <= 0 || center <= 0) return 0;
  const d = Math.log2(bpm / center) / octaveStd;
  return Math.exp(-0.5 * d * d);
}

/** ACF 콤 점수: lag 의 K 개 정수배(하모닉)를 기하감쇠 가중 합산. ac 값은 내부에서 half-wave 정류. */
export function combScore(
  ac: Float32Array,
  lag: number,
  maxLag: number,
  k: number,
  decay: number,
): number {
  let score = 0;
  let w = 1;
  for (let h = 1; h <= k; h++) {
    const l = h * lag;
    if (l > maxLag) break;
    const v = ac[l];
    if (v > 0) score += w * v;
    w *= decay;
  }
  return score;
}

/** 피크 돌출도: 우승 lag 와 그 하모닉/서브하모닉을 제외한 최강 경쟁자 대비 상대 우위(0..1). */
export function peakProminence(
  score: Float32Array,
  lagMin: number,
  lagMax: number,
  winnerLag: number,
): number {
  const winner = score[winnerLag];
  if (winner <= 0) return 0;
  const ratios = [1, 0.5, 2, 1 / 3, 3];
  const tol = 0.06;
  let competitor = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let excluded = false;
    for (let r = 0; r < ratios.length; r++) {
      const center = winnerLag * ratios[r];
      if (Math.abs(lag - center) <= tol * center) {
        excluded = true;
        break;
      }
    }
    if (excluded) continue;
    if (score[lag] > competitor) competitor = score[lag];
  }
  const prom = (winner - competitor) / winner;
  return prom < 0 ? 0 : prom > 1 ? 1 : prom;
}

const ENV_HP_SEC = 0.5; // 지역평균 하이패스 창(초)
const COMB_K = 4; // 콤 하모닉 개수
const COMB_DECAY = 0.5; // 콤 하모닉 감쇠
const DEFAULT_OCT_STD = 0.9; // 기본 옥타브 prior σ
// 온셋 엔벨로프 희소도(Hoyer) 게이트: 드럼 온셋은 희소·뾰족(≈0.8+), 노이즈는 평탄(≈0.45).
// 자기상관/prior 는 처리된 노이즈에도 가짜 피크를 만들 수 있어, 피크성(희소도)으로 신뢰도를 낮춘다.
const SPARSE_LO = 0.48; // 이 이하 희소도 → 신뢰도 0 (노이즈)
const SPARSE_HI = 0.6; // 이 이상 → 온전한 신뢰도

/** Hoyer 희소도 0(평탄)..1(희소) */
function hoyerSparsity(env: Float32Array): number {
  const n = env.length;
  if (n === 0) return 0;
  let l1 = 0;
  let l2 = 0;
  for (let i = 0; i < n; i++) {
    const v = env[i] >= 0 ? env[i] : -env[i];
    l1 += v;
    l2 += env[i] * env[i];
  }
  l2 = Math.sqrt(l2);
  if (l2 <= 0) return 0;
  const sn = Math.sqrt(n);
  return (sn - l1 / l2) / (sn - 1);
}

/**
 * 온셋 엔벨로프에서 템포 추정.
 * @param env  온셋 엔벨로프 (시간순)
 * @param hopTimeSec  엔벨로프 샘플 간격(초) = hop / sampleRate
 * @param opts.center  prior 중심 BPM(곡 모드=목표, 프리=음악적 중앙). 미지정 시 탐색대역 기하중앙.
 * @param opts.octaveStd  prior σ(옥타브 단위).
 */
export function estimateTempo(
  env: Float32Array,
  hopTimeSec: number,
  bpmMin = 40,
  bpmMax = 240,
  opts?: { center?: number; octaveStd?: number },
): TempoEstimate {
  const n = env.length;
  if (n < 16) return { bpm: 0, salience: 0 };

  // 1) 적응 지역평균 하이패스 + 정류 → 주기성 대비를 위해 평균 제거(제자리)
  const winSamp = Math.max(1, Math.round(ENV_HP_SEC / hopTimeSec));
  const x = enhanceEnvelope(env, winSamp);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    x[i] -= mean;
    energy += x[i] * x[i];
  }
  if (energy <= 1e-9) return { bpm: 0, salience: 0 };

  const lagMin = Math.max(2, Math.floor(60 / (bpmMax * hopTimeSec)));
  const lagMax = Math.min(n - 1, Math.ceil(60 / (bpmMin * hopTimeSec)));
  if (lagMax <= lagMin) return { bpm: 0, salience: 0 };

  const acMaxLag = Math.min(n - 1, lagMax * COMB_K);
  const ac = autocorrelate(x, acMaxLag);

  const center =
    opts && opts.center && opts.center > 0 ? opts.center : Math.sqrt(bpmMin * bpmMax);
  const octaveStd =
    opts && opts.octaveStd && opts.octaveStd > 0 ? opts.octaveStd : DEFAULT_OCT_STD;

  // 2) ACF 콤 점수 · 푸리에 템포그램 각각 산출 후 대역최댓값으로 정규화
  const comb = new Float32Array(lagMax + 1);
  const four = new Float32Array(lagMax + 1);
  let combMax = 0;
  let fourMax = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const c = combScore(ac, lag, acMaxLag, COMB_K, COMB_DECAY);
    comb[lag] = c;
    if (c > combMax) combMax = c;
    const bpm = 60 / (lag * hopTimeSec);
    const f = tempogramBin(x, hopTimeSec, bpm);
    four[lag] = f;
    if (f > fourMax) fourMax = f;
  }
  if (combMax <= 0 || fourMax <= 0) return { bpm: 0, salience: 0 };

  // 3) 선택용 결합 점수 = combN × fourN × prior (옥타브 결정),
  //    신뢰도용 데이터 점수 = combN × fourN (prior 제외). prior 는 평탄한 노이즈에도 자기 중심에
  //    가짜 피크를 만들므로, 신뢰도는 반드시 데이터에서만 산출해야 노이즈 오락온을 막는다.
  const scores = new Float32Array(lagMax + 1);
  const dataScores = new Float32Array(lagMax + 1);
  let peakLag = lagMin;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const cN = comb[lag] / combMax;
    const fN = four[lag] / fourMax;
    const bpm = 60 / (lag * hopTimeSec);
    const d = cN * fN;
    dataScores[lag] = d;
    const s = d * tempoPrior(bpm, center, octaveStd);
    scores[lag] = s;
    if (s > scores[peakLag]) peakLag = lag;
  }
  if (scores[peakLag] <= 0) return { bpm: 0, salience: 0 };

  const lag = parabolicPeak(scores, peakLag, lagMin, lagMax);
  const bpm = 60 / (lag * hopTimeSec);
  const prom = peakProminence(dataScores, lagMin, lagMax, peakLag);
  // 피크성 게이트: 평탄한(노이즈) 엔벨로프는 신뢰도를 0 으로 끌어내려 오락온 방지
  const sp = hoyerSparsity(env);
  let peaky = (sp - SPARSE_LO) / (SPARSE_HI - SPARSE_LO);
  peaky = peaky < 0 ? 0 : peaky > 1 ? 1 : peaky;
  return { bpm, salience: prom * peaky };
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

// --- 추적기 튜닝 상수 (균형: 안정적이되 실제 변화는 ~1–2초 내 반영) ---
const BUFFER_SECONDS = 6; // 분석 버퍼. 해상도/안정성 ↔ 응답성 균형(↑이면 안정·둔감, ↓이면 민감·소란).
const RECOMPUTE_EVERY = 8; // ~85ms 마다 재계산
const HISTORY = 8; // 스무딩/안정도 창
const SILENCE_RMS = 0.0015; // 절대 무음 바닥
const EMA_ALPHA = 0.35; // 기준 EMA 계수(신뢰도로 가중)
const STAB_FULL = 6; // std 6BPM 이상이면 안정도 0
const FREE_CENTER = 115; // 프리 모드 prior 중심
const SONG_OCT_STD = 0.7; // 곡 모드 prior σ(목표를 알기에 약간 타이트)
const FREE_OCT_STD = 1.0; // 프리 모드 prior σ
const LOCK_PROM = 0.25; // 락온 최소 돌출도(실제 비트는 0.6+ — 노이즈 오락온 방지 여유)
const LOCK_STD_BPM = 3; // 락온 최소 안정성(최근 std)
const LOCK_SECONDS = 3; // 락온 전 최소 버퍼
const OCTAVE_JUMP_OCT = 0.4; // |log2(new/locked)| 이상이면 큰(옥타브급) 점프로 간주
const JUMP_FRAMES = 3; // 큰 점프 채택에 필요한 연속 일치 프레임
const JUMP_TOL = 0.05; // 점프 후보 동일 판정 상대 허용
const JUMP_CONF = 0.2; // 큰 점프 채택에 필요한 최소 신뢰도
const NOISE_RELEASE = 0.01; // 노이즈 플로어 상승(조용한 구간에서만)
const SNR_MARGIN = 2.5; // 신호 판정 SNR 여유
const UNCLEAR_FRAMES = 24; // 신호는 있으나 박자 불명확이 이만큼 지속되면 락 해제(~2초)

/**
 * 상태를 보유한 실시간 템포 추적기. 워클릿이 보낸 온셋 엔벨로프를 push 하면
 * 내부 순환 버퍼를 갱신하며 주기적으로 추정값을 재계산한다.
 */
export class TempoTracker {
  private hopTimeSec: number;
  private buf: Float32Array; // 순환 버퍼
  private ordered: Float32Array; // 재계산 시 시간순으로 펼친 뷰
  private head = 0;
  private len = 0;
  private newSince = 0;
  private rmsAvg = 0;
  private noiseFloor = SILENCE_RMS;
  private target: number | null = null;

  private rawHist: number[] = [];
  private emaBpm = 0;
  private pendingBpm = 0;
  private pendingCount = 0;
  private missCount = 0;

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
    this.ordered = new Float32Array(n);
  }

  setTarget(bpm: number | null) {
    this.target = bpm && bpm > 0 ? bpm : null;
  }

  reset() {
    this.head = 0;
    this.len = 0;
    this.newSince = 0;
    this.rmsAvg = 0;
    this.noiseFloor = SILENCE_RMS;
    this.rawHist = [];
    this.emaBpm = 0;
    this.pendingBpm = 0;
    this.pendingCount = 0;
    this.missCount = 0;
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

  /** 워클릿 온셋 값(+RMS) 추가 (순환 버퍼, O(1)/샘플) */
  pushEnvelope(values: Float32Array, rms?: Float32Array) {
    const cap = this.buf.length;
    for (let i = 0; i < values.length; i++) {
      this.buf[this.head] = values[i];
      this.head = (this.head + 1) % cap;
      if (this.len < cap) this.len++;
      if (rms) this.rmsAvg = this.rmsAvg * 0.95 + rms[i] * 0.05;
      this.newSince++;
    }
    if (this.newSince >= RECOMPUTE_EVERY) {
      this.newSince = 0;
      this.recompute();
    }
  }

  /** 순환 버퍼를 시간순으로 펼쳐 분석용 뷰 반환 */
  private unwrap(): Float32Array {
    const cap = this.buf.length;
    const len = this.len;
    const start = len < cap ? 0 : this.head; // 가득 차면 가장 오래된 값이 head
    const ord = this.ordered;
    const buf = this.buf;
    for (let i = 0; i < len; i++) ord[i] = buf[(start + i) % cap];
    return ord.subarray(0, len);
  }

  private recompute() {
    // 적응 노이즈 게이트: 조용한 구간에서만 플로어 상승 → 연속 연주 중 오게이팅 방지
    if (this.rmsAvg < this.noiseFloor) this.noiseFloor = this.rmsAvg;
    else if (this.rmsAvg < this.noiseFloor * SNR_MARGIN)
      this.noiseFloor += (this.rmsAvg - this.noiseFloor) * NOISE_RELEASE;
    const hasSignal = this.rmsAvg > Math.max(SILENCE_RMS, this.noiseFloor * SNR_MARGIN);
    if (!hasSignal) {
      this.state.status = 'no-signal';
      this.state.confidence = 0;
      return;
    }

    const view = this.unwrap();
    const minSamples = Math.ceil(LOCK_SECONDS / this.hopTimeSec);
    const center = this.target != null ? this.target : FREE_CENTER;
    const octaveStd = this.target != null ? SONG_OCT_STD : FREE_OCT_STD;

    const est = estimateTempo(view, this.hopTimeSec, 40, 240, { center, octaveStd });
    const conf = est.salience < 0 ? 0 : est.salience > 1 ? 1 : est.salience;
    this.state.confidence = conf;

    if (this.len < minSamples) {
      // 워밍업: 최소 버퍼(~3초) 미달 — 짧은 버퍼의 불안정한 추정으로 조급히 락온하지 않는다
      this.state.status = 'measuring';
      return;
    }
    const clear = est.bpm > 0 && est.salience >= LOCK_PROM;
    if (!clear) {
      if (++this.missCount >= UNCLEAR_FRAMES) {
        // 신호는 있으나 박자 불명확이 지속 → 락 해제, 표시값 초기화
        this.emaBpm = 0;
        this.rawHist = [];
        this.pendingCount = 0;
        this.state.detected = 0;
        this.state.delta = null;
        this.state.stability = 0;
        this.state.status = 'no-signal'; // "신호 없음 / 박자 불명확"
      } else {
        // 짧은 dip — 직전 락 유지
        this.state.status = this.emaBpm > 0 ? 'ok' : 'measuring';
      }
      return;
    }
    this.missCount = 0;

    const folded = foldOctave(est.bpm, this.target);

    if (this.emaBpm <= 0) {
      // 최초 락온
      this.acceptDrift(folded, conf);
      this.pendingCount = 0;
    } else {
      const octDist = Math.abs(Math.log2(folded / this.emaBpm));
      if (octDist >= OCTAVE_JUMP_OCT) {
        // 옥타브급 큰 점프: 지속·고신뢰 확인 전까지 보류
        if (this.pendingCount > 0 && Math.abs(folded - this.pendingBpm) <= JUMP_TOL * this.pendingBpm) {
          this.pendingCount++;
        } else {
          this.pendingBpm = folded;
          this.pendingCount = 1;
        }
        if (this.pendingCount >= JUMP_FRAMES && conf >= JUMP_CONF) {
          // 확정 → 새 템포로 하드 리셋
          this.rawHist = [folded];
          this.emaBpm = folded;
          this.pendingCount = 0;
        }
        // 미확정이면 emaBpm 유지(이상치/일시적 옥타브 플립 무시)
      } else {
        // 작은 드리프트: 즉시 반영
        this.acceptDrift(folded, conf);
        this.pendingCount = 0;
      }
    }

    // 안정도(최근 원시 분산)
    const h = this.rawHist;
    let mu = 0;
    for (let i = 0; i < h.length; i++) mu += h[i];
    mu /= h.length;
    let varr = 0;
    for (let i = 0; i < h.length; i++) varr += (h[i] - mu) * (h[i] - mu);
    const std = Math.sqrt(varr / h.length);

    this.state.rawBpm = folded;
    this.state.detected = this.emaBpm;
    this.state.confidence = conf;
    this.state.stdBpm = std;
    this.state.stability = Math.min(1, Math.max(0, 1 - std / STAB_FULL));
    this.state.delta = this.target != null ? this.emaBpm - this.target : null;
    // 락온 안정성 요건: 최근 std 가 충분히 작아야 'ok'
    this.state.status = std <= LOCK_STD_BPM || this.rawHist.length < 3 ? 'ok' : 'measuring';
  }

  /** median 필터 → 신뢰도 가중 EMA */
  private acceptDrift(folded: number, conf: number) {
    this.rawHist.push(folded);
    if (this.rawHist.length > HISTORY) this.rawHist.shift();
    const med = median(this.rawHist);
    if (this.emaBpm > 0) {
      const alpha = EMA_ALPHA * conf;
      this.emaBpm += alpha * (med - this.emaBpm);
    } else {
      this.emaBpm = med;
    }
  }

  getState(): TempoState {
    return this.state;
  }
}
