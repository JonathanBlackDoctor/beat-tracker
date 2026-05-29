// 템포 엔진 DSP 단위 테스트 (브리프 §8 완료 판정: 알려진 BPM ±2 검출)
// 합성 온셋 엔벨로프(임펄스 열 + 노이즈)로 estimateTempo / foldOctave / TempoTracker 검증.
import { estimateTempo, foldOctave, TempoTracker } from '../src/audio/tempoEngine.ts';

const HOP = 512 / 48000; // ≈ 0.010667초 (48kHz)

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${tag}] ${name}${detail ? '  — ' + detail : ''}`);
}
function near(a: number, b: number, tol: number) {
  return Math.abs(a - b) <= tol;
}

// 결정적 PRNG
function makePrng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function genEnvelope(bpm: number, seconds: number, noise = 0.03): Float32Array {
  const n = Math.floor(seconds / HOP);
  const env = new Float32Array(n);
  const period = 60 / (bpm * HOP); // 엔벨로프 샘플 단위 주기
  const rng = makePrng(0xbeef);
  for (let k = 0; ; k++) {
    const idx = Math.round(k * period);
    if (idx >= n) break;
    env[idx] += 1;
    if (idx + 1 < n) env[idx + 1] += 0.4;
    if (idx + 2 < n) env[idx + 2] += 0.15;
  }
  for (let i = 0; i < n; i++) env[i] += rng() * noise;
  return env;
}

console.log('=== estimateTempo (free 모드, 폴딩 후 ±2~3 BPM) ===');
for (const bpm of [75, 90, 100, 120, 144]) {
  const env = genEnvelope(bpm, 6);
  const est = estimateTempo(env, HOP);
  const folded = foldOctave(est.bpm, null);
  check(
    `detect ${bpm}`,
    near(folded, bpm, 3),
    `raw=${est.bpm.toFixed(2)} folded=${folded.toFixed(2)} salience=${est.salience.toFixed(3)}`,
  );
}

console.log('\n=== foldOctave (옥타브 보정) ===');
check('snap 60→target120', near(foldOctave(60, 120), 120, 0.01));
check('snap 240→target120', near(foldOctave(240, 120), 120, 0.01));
check('snap 119→target120', near(foldOctave(119, 120), 119, 0.01));
check('free 45→90', near(foldOctave(45, null), 90, 0.01));
check('free 300→ <160', foldOctave(300, null) < 160 && foldOctave(300, null) >= 70);

console.log('\n=== TempoTracker (곡 모드, 청크 스트리밍) ===');
{
  const tracker = new TempoTracker(HOP);
  tracker.setTarget(120);
  const env = genEnvelope(122, 6); // 목표 120 대비 +2 빠르게 연주
  const rms = new Float32Array(env.length).fill(0.1);
  // 16개씩 청크로 push (워클릿 배치 모사)
  for (let i = 0; i < env.length; i += 16) {
    tracker.pushEnvelope(env.subarray(i, i + 16), rms.subarray(i, i + 16));
  }
  const st = tracker.getState();
  check('status=ok', st.status === 'ok', `status=${st.status}`);
  check('detected≈122', near(st.detected, 122, 2.5), `detected=${st.detected.toFixed(2)}`);
  check('delta≈+2', st.delta != null && near(st.delta, 2, 2.5), `delta=${st.delta?.toFixed(2)}`);
  check('confidence>0.12', st.confidence > 0.12, `conf=${st.confidence.toFixed(3)}`);
}

console.log('\n=== 무신호 처리 ===');
{
  const tracker = new TempoTracker(HOP);
  const silent = new Float32Array(64);
  const rms = new Float32Array(64).fill(0.0001);
  for (let r = 0; r < 10; r++) tracker.pushEnvelope(silent, rms);
  check("status='no-signal'", tracker.getState().status === 'no-signal');
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
