// 온셋 DSP 단위 테스트 — 합성 PCM 으로 OnsetDsp(SuperFlux+화이트닝+멜) 검증.
// 실측 마이크 없이 온셋 단계의 핵심 속성(비브라토 억제·레벨 불변·수치 안정)을 확인한다.
import { estimateTempo } from '../src/audio/tempoEngine.ts';
import { onsetEnvelope, sum, allFinite } from './pipeline.ts';
import {
  synthBackbeat,
  addVibratoTone,
  hardClip,
  makePrng,
} from './synth.ts';

const SR = 48000;
let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${tag}] ${name}${detail ? '  — ' + detail : ''}`);
}

// 6Hz(비브라토율) 성분 크기 = 엔벨로프의 360BPM 템포그램 빈
function componentAt(env: Float32Array, hopTimeSec: number, hz: number): number {
  const n = env.length;
  const w = 2 * Math.PI * hz * hopTimeSec;
  let re = 0;
  let im = 0;
  for (let t = 0; t < n; t++) {
    re += env[t] * Math.cos(w * t);
    im += env[t] * Math.sin(w * t);
  }
  return Math.sqrt(re * re + im * im) / n;
}

console.log('=== 수치 안정성 (NaN/Inf 없음) ===');
{
  const pcm = synthBackbeat(120, 4, { sr: SR });
  const { env, rms } = onsetEnvelope(pcm, SR);
  check('env 유한', allFinite(env));
  check('rms 유한', allFinite(rms));
  let nonneg = true;
  for (let i = 0; i < env.length; i++) if (env[i] < 0) nonneg = false;
  check('env 비음수', nonneg);
  check('env 에너지 존재', sum(env) > 0, `sum=${sum(env).toFixed(3)}`);
}

console.log('\n=== SuperFlux 비브라토 억제 (radius 2 vs 0) ===');
{
  // 순수 비브라토 톤(밴드를 넘나드는 워블): 플레인 플럭스는 변조율 리플을 내지만 SuperFlux 는 억제
  const sec = 3;
  const vibHz = 5.5;
  const tone = new Float32Array(Math.floor(sec * SR));
  addVibratoTone(tone, SR, 320, vibHz, 0.12, 0.6);
  const sf = onsetEnvelope(tone, SR); // 기본 maxFilterRadius=2
  const plain = onsetEnvelope(tone, SR, { maxFilterRadius: 0 });
  const sf6 = componentAt(sf.env, sf.hopTimeSec, vibHz);
  const plain6 = componentAt(plain.env, plain.hopTimeSec, vibHz);
  check(
    'SuperFlux 가 비브라토 변조 성분을 억제(>35%)',
    sf6 < 0.65 * plain6,
    `sf=${sf6.toFixed(5)} plain=${plain6.toFixed(5)} (sf/plain=${(sf6 / (plain6 || 1e-9)).toFixed(2)})`,
  );
  check('총 온셋 에너지도 감소', sum(sf.env) < sum(plain.env), `sf=${sum(sf.env).toFixed(3)} plain=${sum(plain.env).toFixed(3)}`);
}

console.log('\n=== 화이트닝 레벨 불변 (×1, ×0.1, ×4+클립) ===');
{
  const base = synthBackbeat(120, 6, { sr: SR, seed: 0x77 });
  const q1 = onsetEnvelope(base, SR);
  const t1 = estimateTempo(q1.env, q1.hopTimeSec);

  const quiet = Float32Array.from(base, (v) => v * 0.1);
  const q2 = onsetEnvelope(quiet, SR);
  const t2 = estimateTempo(q2.env, q2.hopTimeSec);

  const loud = hardClip(Float32Array.from(base, (v) => v * 4), 1); // 클리핑
  const q3 = onsetEnvelope(loud, SR);
  const t3 = estimateTempo(q3.env, q3.hopTimeSec);

  const ok = (b: number) => Math.abs(b - 120) <= 3 || Math.abs(b - 60) <= 3 || Math.abs(b - 240) <= 4;
  check('×1 검출', ok(t1.bpm), `bpm=${t1.bpm.toFixed(2)} sal=${t1.salience.toFixed(2)}`);
  check('×0.1 검출(동일)', ok(t2.bpm), `bpm=${t2.bpm.toFixed(2)} sal=${t2.salience.toFixed(2)}`);
  check('×4+클립 검출(동일)', ok(t3.bpm), `bpm=${t3.bpm.toFixed(2)} sal=${t3.salience.toFixed(2)}`);
}

console.log('\n=== 온셋 정렬 (자기상관 피크가 비트 주기에 위치) ===');
{
  // 무음 마디 후 시작해도 첫 온셋 부근에 플럭스 스파이크가 잡히는지(타이밍 sanity)
  const pcm = synthBackbeat(100, 5, { sr: SR, seed: 0xab });
  const { env, hopTimeSec } = onsetEnvelope(pcm, SR);
  // 8분음표 주기(샘플) = 30/bpm / hopTime; 비트(4분) = 60/bpm / hopTime
  const beatLag = 60 / 100 / hopTimeSec;
  // 엔벨로프 자기상관에서 beatLag 근방 피크가 평균 이상으로 두드러지는지
  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i];
  mean /= env.length;
  const x = Float32Array.from(env, (v) => v - mean);
  function ac(lag: number): number {
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
    return s;
  }
  const center = Math.round(beatLag);
  let peak = -Infinity;
  for (let l = center - 2; l <= center + 2; l++) if (ac(l) > peak) peak = ac(l);
  check('비트 주기 자기상관 양(+)', peak > 0, `beatLag≈${beatLag.toFixed(1)} ac=${peak.toFixed(3)}`);
}

// makePrng 결정성 확인(픽스처 재현성)
{
  const a = makePrng(42);
  const b = makePrng(42);
  check('PRNG 결정적', a() === b() && a() === b());
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
