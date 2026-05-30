// 패리티 가드 (b2 아키텍처): public/onset-worklet.js 는 src/audio/onsetDsp.ts 의 수기 미러다.
// 워클릿이 빌드 번들이 아니라 정적 자산으로 서빙되므로(오프라인/Pages 확실성), 두 구현의 상수가
// 어긋나면 큰 소리로 실패시켜 미러 드리프트를 막는다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_ONSET_CONFIG } from '../src/audio/onsetDsp.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../public/onset-worklet.js'), 'utf8');

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${tag}] ${name}${detail ? '  — ' + detail : ''}`);
}

console.log('=== 워클릿 ↔ onsetDsp 상수 lockstep ===');
const cfg = DEFAULT_ONSET_CONFIG;
const consts: Array<[string, RegExp, number]> = [
  ['FRAME', /FRAME\s*=\s*([\d.eE+-]+)/, cfg.frame],
  ['HOP', /HOP\s*=\s*([\d.eE+-]+)/, cfg.hop],
  ['NUM_BANDS', /NUM_BANDS\s*=\s*([\d.eE+-]+)/, cfg.numBands],
  ['F_LO', /F_LO\s*=\s*([\d.eE+-]+)/, cfg.fLo],
  ['F_HI', /F_HI\s*=\s*([\d.eE+-]+)/, cfg.fHi],
  ['WHITEN_TAU', /WHITEN_TAU\s*=\s*([\d.eE+-]+)/, cfg.whitenTauSec],
  ['WHITEN_FLOOR', /WHITEN_FLOOR\s*=\s*([\d.eE+-]+)/, cfg.whitenFloor],
  ['MAX_FILTER_RADIUS', /MAX_FILTER_RADIUS\s*=\s*([\d.eE+-]+)/, cfg.maxFilterRadius],
  ['MU', /MU\s*=\s*([\d.eE+-]+)/, cfg.mu],
];
for (const [name, re, expected] of consts) {
  const m = src.match(re);
  const got = m ? parseFloat(m[1]) : NaN;
  check(`${name}=${expected}`, m != null && got === expected, m ? `워클릿=${m[1]}` : '미발견');
}

console.log('\n=== 지각 대역가중 곡선 브레이크포인트 일치 ===');
for (const lit of ['0.6 + 0.4', '<= 800', '<= 4000', '<= 12000', '0.35', '0.3 * Math.max']) {
  check(`perceptualBandWeight 에 "${lit}"`, src.includes(lit));
}

console.log('\n=== 프로토콜·명칭·알고리즘 단계 보존 (load-bearing) ===');
check("registerProcessor('onset-processor')", /registerProcessor\(\s*['"]onset-processor['"]/.test(src));
check("메시지 type:'onset'", /type:\s*['"]onset['"]/.test(src));
check("메시지 type:'active' 수신", /['"]active['"]/.test(src));
check('values/rms 동봉', /values\s*:/.test(src) && /rms\s*:/.test(src));
check('멜 필터뱅크(hzToMel/buildMelFilterBank)', /hzToMel/.test(src) && /buildMelFilterBank/.test(src));
check('적응 화이트닝(whitenDecay + peak)', /whitenDecay/.test(src) && /peak\[/.test(src));
check('SuperFlux(specRing + max-filter)', /specRing/.test(src) && /refBase/.test(src));
check('mag = sqrt(re²+im²) (hypot/log1p 미사용)', /Math\.sqrt\(re\[k\]/.test(src) && !/log1p/.test(src) && !/Math\.hypot/.test(src));

console.log('\n=== 핫패스 무할당 가드 ===');
// process()/computeFrame() 본문에서 새 배열 할당이 없어야 함(배치 postMessage 의 slice 만 허용)
const body = src.slice(src.indexOf('computeFrame()'));
const newAllocs = (body.match(/new Float32Array|new Array|\[\s*\]/g) || []).length;
check('computeFrame 이후 new 배열 할당 없음', newAllocs === 0, `발견=${newAllocs}`);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
