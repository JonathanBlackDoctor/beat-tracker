// 엔드투엔드 템포 인식 테스트 — 합성 PCM → OnsetDsp → estimateTempo/TempoTracker.
// 전문가급 기준: ±2~3 BPM, 옥타브 오류 없음, 락온/드리프트/저SNR/잔향/비브라토 강건.
import { estimateTempo, foldOctave, TempoTracker } from '../src/audio/tempoEngine.ts';
import type { TempoState } from '../src/audio/tempoEngine.ts';
import { onsetEnvelope } from './pipeline.ts';
import {
  synthBackbeat,
  synthRamp,
  addReverb,
  addNoiseAtSnr,
  addVibratoTone,
  makePrng,
} from './synth.ts';

const SR = 48000;
let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${tag}] ${name}${detail ? '  — ' + detail : ''}`);
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** 프리 모드 정적 검출: PCM → 폴딩된 BPM */
function detectFree(pcm: Float32Array): { bpm: number; sal: number } {
  const { env, hopTimeSec } = onsetEnvelope(pcm, SR);
  const est = estimateTempo(env, hopTimeSec);
  return { bpm: foldOctave(est.bpm, null), sal: est.salience };
}

/** 워클릿 배치를 모사해 PCM 을 트래커에 스트리밍 */
function streamPcm(tracker: TempoTracker, pcm: Float32Array, chunk = 16): TempoState {
  const { env, rms } = onsetEnvelope(pcm, SR);
  for (let i = 0; i < env.length; i += chunk) {
    tracker.pushEnvelope(env.subarray(i, i + chunk), rms.subarray(i, i + chunk));
  }
  return tracker.getState();
}

console.log('=== 백비트 검출 (킥1·3 + 스네어2·4 + 8분 하이햇), 옥타브 오류 없이 ±3 ===');
for (const bpm of [75, 90, 100, 120, 144]) {
  const pcm = synthBackbeat(bpm, 7, { sr: SR, seed: 0x100 + bpm });
  const { bpm: det, sal } = detectFree(pcm);
  check(`detect ${bpm}`, near(det, bpm, 3), `det=${det.toFixed(2)} sal=${sal.toFixed(2)}`);
}

console.log('\n=== 곡 모드 스냅 + 소량 Δ (목표 120, 124 연주) ===');
{
  const tracker = new TempoTracker(512 / SR);
  tracker.setTarget(120);
  const st = streamPcm(tracker, synthBackbeat(124, 7, { sr: SR, seed: 0x7c }));
  check('status=ok', st.status === 'ok', `status=${st.status}`);
  check('detected≈124', near(st.detected, 124, 3), `det=${st.detected.toFixed(2)}`);
  check('delta≈+4', st.delta != null && near(st.delta, 4, 3), `Δ=${st.delta?.toFixed(2)}`);
}

console.log('\n=== 절반/2배 함정: 백비트 강조(스네어 큼)도 정 octave ===');
for (const bpm of [80, 128]) {
  const pcm = synthBackbeat(bpm, 7, { sr: SR, seed: 0x200 + bpm, snareGain: 1.4, hatGain: 0.3 });
  const { bpm: det } = detectFree(pcm);
  check(`backbeat-heavy ${bpm}`, near(det, bpm, 3), `det=${det.toFixed(2)}`);
}

console.log('\n=== 스윙/셔플(트리플렛 필) ±3, 1.5× 오검출 없음 ===');
for (const bpm of [92, 120]) {
  const pcm = synthBackbeat(bpm, 7, { sr: SR, seed: 0x300 + bpm, swing: 0.33 });
  const { bpm: det } = detectFree(pcm);
  check(`swing ${bpm}`, near(det, bpm, 3), `det=${det.toFixed(2)}`);
}

console.log('\n=== 싱코페이션/다운비트 누락(킥 50% 드롭) ±3 ===');
for (const bpm of [100, 132]) {
  const pcm = synthBackbeat(bpm, 8, { sr: SR, seed: 0x400 + bpm, dropKick: 0.5 });
  const { bpm: det } = detectFree(pcm);
  check(`syncopation ${bpm}`, near(det, bpm, 3), `det=${det.toFixed(2)}`);
}

console.log('\n=== 잔향 꼬리(방 울림) ±3 (지속음을 온셋으로 안 읽음) ===');
for (const bpm of [96, 126]) {
  const pcm = addReverb(synthBackbeat(bpm, 7, { sr: SR, seed: 0x500 + bpm }), SR, 0.35, 0.45);
  const { bpm: det } = detectFree(pcm);
  check(`reverb ${bpm}`, near(det, bpm, 3), `det=${det.toFixed(2)}`);
}

console.log('\n=== 지속 비브라토 톤(멜로디 악기) 위에서도 드럼 템포 검출 ===');
{
  const pcm = synthBackbeat(112, 7, { sr: SR, seed: 0x5a });
  addVibratoTone(pcm, SR, 330, 5.5, 0.06, 0.5); // 드럼 위에 비브라토 톤 덮음
  const { bpm: det } = detectFree(pcm);
  check('drums+vibrato 112', near(det, 112, 3), `det=${det.toFixed(2)}`);
}

console.log('\n=== 저SNR: 적정 SNR 락온 / 순수 노이즈는 오검출(ok) 금지 ===');
{
  const noisy = addNoiseAtSnr(synthBackbeat(120, 8, { sr: SR, seed: 0x60 }), 6);
  const { bpm: det, sal } = detectFree(noisy);
  check('SNR 6dB 검출', near(det, 120, 4), `det=${det.toFixed(2)} sal=${sal.toFixed(2)}`);

  const n = Math.floor(8 * SR);
  const noise = new Float32Array(n);
  const rng = makePrng(0xdead);
  for (let i = 0; i < n; i++) noise[i] = (rng() * 2 - 1) * 0.05;
  const tracker = new TempoTracker(512 / SR);
  const st = streamPcm(tracker, noise);
  check("순수 노이즈 status!=='ok'", st.status !== 'ok', `status=${st.status} det=${st.detected.toFixed(1)}`);
}

console.log('\n=== 락온 시간: measuring→ok 가 ~3–5초 내 ===');
{
  const { env, rms, hopTimeSec } = onsetEnvelope(synthBackbeat(118, 10, { sr: SR, seed: 0x70 }), SR);
  const tracker = new TempoTracker(hopTimeSec);
  let lockSample = -1;
  let pushed = 0;
  for (let i = 0; i < env.length; i += 16) {
    const end = Math.min(i + 16, env.length);
    tracker.pushEnvelope(env.subarray(i, end), rms.subarray(i, end));
    pushed = end;
    if (lockSample < 0 && tracker.getState().status === 'ok') lockSample = pushed;
  }
  const lockSec = lockSample >= 0 ? lockSample * hopTimeSec : Infinity;
  check('락온 ≤5초', lockSec <= 5, `lock=${lockSec.toFixed(2)}s`);
  check('락온 ≥3초(조급한 오락온 아님)', lockSec >= 3, `lock=${lockSec.toFixed(2)}s`);
  check('락온 후 detected≈118', near(tracker.getState().detected, 118, 3), `det=${tracker.getState().detected.toFixed(2)}`);
}

console.log('\n=== 드리프트 추종: 120→128 (10초 램프 + 8초 유지) ===');
{
  const pcm = synthRamp(120, 128, 10, 8, { sr: SR, seed: 0x80 });
  const tracker = new TempoTracker(512 / SR);
  tracker.setTarget(124); // 곡 중심
  const st = streamPcm(tracker, pcm);
  check('드리프트 후 detected≈128', near(st.detected, 128, 3), `det=${st.detected.toFixed(2)}`);
  check('드리프트 반영(>124)', st.detected > 124, `det=${st.detected.toFixed(2)}`);
}

console.log('\n=== 안정성: 락온 후 옥타브 점프 없이 일정 (120) ===');
{
  const { env, rms, hopTimeSec } = onsetEnvelope(synthBackbeat(120, 12, { sr: SR, seed: 0x90, snareGain: 1.3 }), SR);
  const tracker = new TempoTracker(hopTimeSec);
  let minD = Infinity;
  let maxD = -Infinity;
  let locked = false;
  for (let i = 0; i < env.length; i += 16) {
    const end = Math.min(i + 16, env.length);
    tracker.pushEnvelope(env.subarray(i, end), rms.subarray(i, end));
    const s = tracker.getState();
    if (s.status === 'ok') locked = true;
    if (locked && s.detected > 0) {
      if (s.detected < minD) minD = s.detected;
      if (s.detected > maxD) maxD = s.detected;
    }
  }
  check('락온 도달', locked);
  check('옥타브 점프 없음([108,132] 유지)', minD >= 108 && maxD <= 132, `range=[${minD.toFixed(1)},${maxD.toFixed(1)}]`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
