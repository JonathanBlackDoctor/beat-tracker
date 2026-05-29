// 비트키퍼 데이터 모델 (브리프 §7)

export type Meter = '4/4' | '3/4' | '6/8';
export type ClickSound = 'woodblock' | 'beep' | 'hihat' | 'rim';
export type Subdivision = 'off' | '8' | '16';
export type MeasureMode = 'always' | 'tap';
/** 카운트인: 시작 전 미리 칠 마디 수 (0 = off) */
export type CountIn = 0 | 1 | 2;

export interface Section {
  id: string;
  name: string;
  bpm: number;
  /** 미지정 시 곡 기본 박자표 상속 */
  meter?: Meter;
  /** 자동 전환용(선택). 미지정 시 수동 전환만 */
  bars?: number;
}

export interface Song {
  id: string;
  name: string;
  defaultBpm: number;
  meter: Meter;
  notes?: string;
  /** 없으면 단일 템포 곡 */
  sections?: Section[];
}

export interface Setlist {
  id: string;
  name: string;
  /** 순서 있는 곡 ID 목록 */
  songIds: string[];
}

export interface Settings {
  clickSound: ClickSound;
  /** 0..1 */
  clickVolume: number;
  accentBeat1: boolean;
  countIn: CountIn;
  subdivision: Subdivision;
  /** 드리프트 색 임계값(BPM). |Δ| ≤ green → 초록, ≤ yellow → 노랑, 초과 → 빨강 */
  greenThreshold: number;
  yellowThreshold: number;
  vibration: boolean;
  defaultMeasureMode: MeasureMode;
  keepScreenOn: boolean;
  language: 'ko';
  /** 바늘 풀스케일(±BPM). 기본 8 */
  needleFullScale: number;
  /** 바 수 기반 섹션 자동 전환 사용 여부(기본 off → 수동) */
  autoAdvanceSections: boolean;
}

/** Phase 3 — 세션 기록(파생 BPM 시계열만 저장, 원음 저장 없음) */
export interface SessionSample {
  /** 시작 후 경과 ms */
  t: number;
  bpm: number;
  delta: number;
}

export interface Session {
  id: string;
  songId: string;
  songName: string;
  targetBpm: number;
  startedAt: number;
  durationMs: number;
  samples: SessionSample[];
}

export const DEFAULT_SETTINGS: Settings = {
  clickSound: 'woodblock',
  clickVolume: 0.8,
  accentBeat1: true,
  countIn: 0,
  subdivision: 'off',
  greenThreshold: 1.5,
  yellowThreshold: 4,
  vibration: false,
  defaultMeasureMode: 'always',
  keepScreenOn: true,
  language: 'ko',
  needleFullScale: 8,
  autoAdvanceSections: false,
};

export const METERS: Meter[] = ['4/4', '3/4', '6/8'];

/** 박자표별 한 마디의 메인 박(펄스 링 펄스 단위) 수 */
export function mainBeatsPerBar(meter: Meter): number {
  switch (meter) {
    case '4/4':
      return 4;
    case '3/4':
      return 3;
    case '6/8':
      return 2; // 점4분음표 2박 (브리프 §5)
  }
}
