import { Platform } from 'react-native';

import { BRAND } from '../brand';
import type { Lang } from '../i18n';

export type SurfaceTheme = {
  /** true면 앱 테마를 그대로 따른다 */
  linked: boolean;
  accent: string;
  card: string | null;
  /** 배경 불투명도 0~1 */
  opacity: number;
};

export type Prefs = {
  themeMode: 'system' | 'dark' | 'light';
  accent: string;
  /** 상단 그라데이션 강도 0~1 */
  gradient: number;
  /** null = 기본 카드색 */
  card: string | null;
  checkSide: 'left' | 'right';
  font: 'system' | 'serif' | 'mono';
  weight: 'light' | 'regular' | 'bold';
  size: 's' | 'm' | 'l' | 'xl';
  newTodoAt: 'top' | 'bottom';
  showDone: boolean;
  /** 로고 심볼도 테마색으로(끄면 늘 대표색). 위젯 로고도 따른다 */
  logoAccent: boolean;
  /** 테마색을 마지막으로 바꾼 시각(밀리초). 계정 테마와 맞출 때 늦게 바꾼 쪽이 이긴다. 0 = 아직 안 바꿈 */
  accentAt: number;
  language: 'system' | Lang;
  widget: SurfaceTheme;
  mini: SurfaceTheme;
  lock: { enabled: boolean; visibility: 'public' | 'private' | 'secret' };
  hintSeen: boolean;
  /** 첫 실행 화면(테마색 + 첫 할 일)을 마쳤는지. 휴대폰만 */
  onboarded: boolean;
  server: string;
};

// 맨 앞은 대표색(src/brand.ts). 화이트·블랙·그레이 같은 무채색도 포함. 배경과 대비가 모자라면 theme.ts가 보이게 보정한다.
// 예전 기본색(OLD_DEFAULTS)은 불러올 때 대표색으로 바꾸므로(mergePrefs) 목록에 두지 않는다.
const CHARCOAL = '#4B4F58';

// 전체 팔레트 순서는 고정(사용자가 기억한 자리 유지). 새 색은 맨 뒤에만 붙인다(차콜: 2026-10-18)
export const ACCENTS = [BRAND, '#FF7F6B', '#5FD38D', '#F5C451', '#B79CFF', '#FF8EC6', '#4FD1C5', '#FFA45B', '#FF6B6B', '#FFFFFF', '#A7B0BE', '#111111', CHARCOAL];

/** 꾸미기 첫 화면의 테마 색상 4개: 파랑(대표색)·차콜·화이트·주황(사용자 요청 2026-10-18). 전체 팔레트에도 있는 색이라 어느 화면에서 골라도 선택이 이어 보인다 */
export const MAIN_ACCENTS = [BRAND, CHARCOAL, '#FFFFFF', '#FFA45B'];

// Took의 카드 스와치와 같은 구성: 검정, 회색, 흰색, 살구, 빨강, 주황, 노랑, 초록, 청록, 파랑, 보라, 분홍 (+ 사용자 지정)
export const CARD_SWATCHES = [
  '#0E0F11',
  '#8E9096',
  '#F2F2F4',
  '#C8796D',
  '#B4473F',
  '#B8741E',
  '#B39A2E',
  '#3E8E4E',
  '#1F8C7F',
  '#2C6FB8',
  '#7C4FAF',
  '#B4467E',
];

export const DEFAULT_SERVER = process.env.EXPO_PUBLIC_API_URL ?? 'https://modo.kodeploy.com';

export const DEFAULT_PREFS: Prefs = {
  themeMode: 'system',
  accent: ACCENTS[0],
  gradient: 0.7,
  card: null,
  checkSide: 'left',
  font: 'system',
  weight: 'regular',
  size: 'm',
  newTodoAt: 'bottom',
  // PC(큰 창): 완료한 할 일은 숨겨 두고 ⋯ '완료 항목 표시'로 꺼내 본다(미니창도 같다). 휴대폰은 목록 아래 '완료' 묶음으로
  showDone: Platform.OS !== 'web',
  logoAccent: true,
  accentAt: 0,
  language: 'system',
  // 위젯 배경: 반투명(불투명도 65%)
  // 위젯·미니창 배경: 시안의 '투명도 80%'(불투명도 80%)
  widget: { linked: true, accent: ACCENTS[0], card: null, opacity: 0.8 },
  mini: { linked: true, accent: ACCENTS[0], card: null, opacity: 0.8 },
  lock: { enabled: false, visibility: 'private' },
  hintSeen: false,
  onboarded: false,
  server: DEFAULT_SERVER,
};

// 예전에 기본색이었던 색들(대표색을 바꿨다 되돌려도 지금 대표색은 빼고)
const OLD_DEFAULTS = ['#72CDF4', '#96D3FD', '#85ADE2'].filter((c) => c !== BRAND);

export function mergePrefs(saved: Partial<Prefs> | null): Prefs {
  const p = { ...DEFAULT_PREFS, ...(saved ?? {}) };
  // 첫 실행 화면이 생기기 전부터 쓰던 사람(설정이 이미 저장돼 있으면)은 마친 것으로
  if (saved && saved.onboarded === undefined) p.onboarded = true;
  p.widget = { ...DEFAULT_PREFS.widget, ...(saved?.widget ?? {}) };
  // 예전 기본값(92%, 70%, 45%)을 그대로 두고 있던 경우는 새 기본값으로
  if ([0.92, 0.7, 0.45, 0.65].includes(saved?.widget?.opacity ?? -1)) p.widget.opacity = DEFAULT_PREFS.widget.opacity;
  if (saved?.mini?.opacity === 0.96) p.mini.opacity = DEFAULT_PREFS.mini.opacity;
  p.mini = { ...DEFAULT_PREFS.mini, ...(saved?.mini ?? {}) };
  p.lock = { ...DEFAULT_PREFS.lock, ...(saved?.lock ?? {}) };
  // 예전 기본 강조색을 그대로 쓰던 경우는 지금 대표색으로
  const old = (c?: string) => !!c && OLD_DEFAULTS.includes(c.toUpperCase());
  if (old(saved?.accent)) p.accent = DEFAULT_PREFS.accent;
  for (const k of ['widget', 'mini'] as const) if (old(saved?.[k]?.accent)) p[k].accent = DEFAULT_PREFS.accent;
  return p;
}
