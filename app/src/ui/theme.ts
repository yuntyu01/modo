import { Platform, type TextStyle } from 'react-native';

import { BRAND } from '../brand';
import type { Prefs, SurfaceTheme } from '../state/prefs';
import { contrast, ensureContrast, hexToRgb, hsvToRgb, luminance, mix, rgbToHex, rgbToHsv, withAlpha } from './color';

export type Theme = {
  dark: boolean;
  accent: string;
  /** 로고 심볼 색: '로고도 테마색으로'(기본 켬)면 테마색(흰색·검정처럼 바탕에 묻히는 색만 조금 보정), 끄면 대표색 */
  mark: string;
  /** 테마색 위 글자/아이콘 색 */
  onAccent: string;
  bg: string;
  gradientTop: string;
  /** 위쪽 그라데이션 중간색(PC 큰 창은 시안의 하늘빛 단계) */
  gradientMid: string;
  /** 위쪽 그라데이션 세 색의 위치(화면 높이 비율) */
  gradientStops: [number, number, number];
  card: string;
  /** 할 일·메모·달력 카드: 은은하게 비치는 카드(위쪽 테마색 그라데이션이 살짝 비친다) */
  todoCard: string;
  /** 할 일 카드 색(불투명). PC 미니창은 이 색에 자기 투명도를 입혀 블록을 그린다(앱 카드와 같은 색) */
  todoCardSolid: string;
  cardPressed: string;
  /** 선택된 옵션 카드(꾸미기의 체크 위치 등) */
  cardActive: string;
  /** 글자를 끌어 선택했을 때 하이라이트(배민 기술블로그처럼 테마색) */
  selection: string;
  composer: string;
  nav: string;
  raised: string;
  text: string;
  muted: string;
  subtle: string;
  tab: string;
  circle: string;
  outline: string;
  danger: string;
  font: (size: number, extra?: TextStyle) => TextStyle;
  /** 화면 글자: 시안의 글자 폭에 맞춘 크기(Pretendard는 시안 글꼴보다 약 9% 넓어 0.91배) */
  kfont: (size: number, extra?: TextStyle) => TextStyle;
  scale: number;
  /** 휴대폰 홈 요소(로고·폴더 이름·메모·할 일 카드·입력창)를 시안 치수보다 조금 크게 그리는 배율. PC(웹)는 1 */
  zoom: number;
  /** PC 큰 창(시안): 카드 안 글자·동그라미가 휴대폰보다 조금 크다. 미니창·휴대폰은 false */
  desk: boolean;
  /** PC 미니창(시안): 할 일 카드·입력창 치수가 조금 다르다 */
  mini: boolean;
};

const SIZE = { s: 0.9, m: 1, l: 1.12, xl: 1.25 };
const WEIGHT: Record<Prefs['weight'], TextStyle['fontWeight']> = { light: '300', regular: '400', bold: '600' };

// 기본 서체는 시안(아이폰: SF + Apple SD 산돌고딕 Neo)과 같은 꼴로 만든 Pretendard(OFL).
// 휴대폰은 앱에 싣고(assets/fonts, expo-font), PC(웹)는 글자 범위별로 나눠 싣는다(app/public/fonts).
const WEB_SANS = 'Pretendard, "Segoe UI", "Malgun Gothic", sans-serif';
const KFONT = 0.91;
// 휴대폰 홈은 시안 치수 그대로면 조금 작아 보여 5%만 키운다(사용자 요청 2026-10-17)
const ZOOM = Platform.OS === 'web' ? 1 : 1.05;

function fontFamily(f: Prefs['font']): string | undefined {
  if (f === 'system') return Platform.OS === 'web' ? WEB_SANS : 'Pretendard';
  if (Platform.OS === 'android') return f === 'serif' ? 'serif' : 'monospace';
  if (Platform.OS === 'ios') return f === 'serif' ? 'AppleMyungjo' : 'Menlo';
  return f === 'serif' ? 'Batang, "Noto Serif KR", serif' : 'Consolas, "D2Coding", monospace';
}

/** 이보다 채도가 낮은 테마색은 무채색으로 본다(그라데이션·카드 물들이기 없이 회색) */
const NEUTRAL_S = 0.2;

/** 테마색의 색상(hue)으로 위쪽 그라데이션 시작색을 만든다. 다크는 어두운 남색(시안 #071930보다 진하게: 사용자 요청 2026-10-16, 2026-10-17에 조금 낮춤). */
function gradientTop(accent: string, intensity: number, dark: boolean, bg: string) {
  const [h0, s] = rgbToHsv(hexToRgb(accent));
  // 무채색(화이트·블랙·그레이·차콜)은 회색 그라데이션. 살짝 푸른 회색(#A7B0BE, 채도 0.12)도 회색으로(남색이 나왔다: 사용자 제보 2026-10-18)
  // 밝기를 따라 다르게: 화이트는 은빛, 그레이는 중간, 차콜은 은은하게, 블랙은 거의 없이(모두 같은 회색이라 화이트·차콜이 똑같아 보였다: 사용자 제보 2026-10-18)
  if (s < NEUTRAL_S) {
    const l = Math.sqrt(luminance(accent));
    return dark ? mix(bg, mix('#2E3034', '#8C8F96', l), intensity * 0.75) : mix(bg, mix('#C3C6CC', '#E6E8EB', l), intensity * 0.7);
  }
  // 테마색의 색상(hue)을 그대로(대표색이면 대표색 계열의 남색·하늘색)
  const h = h0;
  // 은은하게(사용자 요청 2026-10-17): 다크는 남색을 70%만, 라이트는 하늘빛을 더 옅게
  if (dark) return mix(bg, rgbToHex(hsvToRgb(h, Math.max(0.7, Math.min(0.92, s + 0.45)), 0.29)), intensity * 0.7);
  // 라이트(화이트 시안보다 옅게): 아주 옅은 하늘빛(#E6EFFC 안팎)에서 금방 흰 바탕으로
  return mix(bg, rgbToHex(hsvToRgb(h, 0.32, 1)), intensity * 0.33);
}

/** 다크 카드에 테마색 색상의 짙은 남색을 14%만 섞는다(무채색 테마는 그대로) */
function glassTint(card: string, accent: string) {
  const [h0, s] = rgbToHsv(hexToRgb(accent));
  if (s < NEUTRAL_S) return card;
  return mix(card, rgbToHex(hsvToRgb(h0, 0.72, 0.28)), 0.14);
}

const onDesktop = () => Platform.OS === 'web' && typeof window !== 'undefined' && !!(window as { desktop?: unknown }).desktop;


export function makeTheme(p: Prefs, systemDark: boolean, surface?: SurfaceTheme): Theme {
  const dark = p.themeMode === 'system' ? systemDark : p.themeMode === 'dark';
  const rawAccent = surface && !surface.linked ? surface.accent : p.accent;
  const cardPref = surface && !surface.linked ? surface.card : p.card;
  // PC 미니창(메모)도 색은 앱(휴대폰·PC 큰 창)과 똑같다: 바탕·카드·입력칸·글자·그라데이션 모두(사용자 요청 2026-10-18).
  // 예전엔 미니창만 회색 바탕 #1E1F22·카드 #2A2C30·하늘색 포인트를 따로 써서 미니창만 푸른 회색으로 보였다. 창 투명도만 미니창 설정을 따른다
  // 라이트 바탕은 화이트 시안의 거의 흰색(#F7F9FC)
  const bg = dark ? '#000000' : '#F7F9FC';
  const point = rawAccent;
  // 다크에서 블랙, 라이트에서 화이트를 골라도 아이콘·선택 표시가 보이게 보정(대표색은 흰 바탕에서도 그대로 쓰이게 2:1까지만).
  // 바탕과 같은 무채색(라이트의 화이트, 다크의 블랙)은 회색으로 흐리지 않고 반대쪽 무채색으로: 회색 스위치·버튼이 꺼진 것처럼 보였다(사용자 요청 2026-10-18)
  const surfaceBg = dark ? '#1B1C20' : '#FFFFFF';
  const flat = rgbToHsv(hexToRgb(point))[1] < NEUTRAL_S && contrast(point, surfaceBg) < 2;
  const accent = flat ? (dark ? '#F2F3F5' : '#1B1C20') : ensureContrast(point, surfaceBg, 2);
  // 다크 카드·입력창·하단바·알약 색은 시안에서 잰 값
  const baseCard = dark ? '#1B1C20' : '#FFFFFF';
  // 카드색은 기본 카드 위에 살짝 물들이는 정도로(과한 강조 배경 피하기)
  const card = cardPref ? mix(baseCard, cardPref, dark ? 0.32 : 0.16) : baseCard;
  // PC 큰 창·미니창도 색(바탕·그라데이션·블록·글자)은 휴대폰 앱과 같다(사용자 요청). 배치·크기만 PC 시안대로
  const desk = onDesktop() && !surface && !window.location.pathname.startsWith('/mini');
  const top = gradientTop(rawAccent, p.gradient, dark, bg);
  const scale = SIZE[p.size];
  const family = fontFamily(p.font);
  const weight = WEIGHT[p.weight];
  return {
    dark,
    accent,
    // 로고 심볼: 테마색과 똑같이(아이콘·선택 표시와 같은 값). 끄면 대표색
    mark: p.logoAccent === false ? BRAND : accent,
    bg,
    // 테마색 위 체크·화살표: 대표색처럼 중간 밝기는 흰색(시안), 아주 밝은 색만 검정
    onAccent: luminance(accent) > 0.45 ? '#0B0C0E' : '#FFFFFF',
    gradientTop: top,
    gradientMid: mix(top, bg, dark ? 0.55 : 0.45),
    // 다크: 화면 2/3쯤에서 바탕색, 라이트(화이트 시안): 화면 40%쯤에서 바탕색. 미니창도 같다
    // (예전엔 미니창만 창 끝까지 천천히 녹아 바탕 전체에 푸른 기가 남았다: 사용자 제보 2026-10-18)
    gradientStops: dark ? [0, 0.32, 0.68] : [0, 0.18, 0.42],
    card,
    // 다크: 바탕이 살짝 비치게(80%), 테마색 쪽으로 아주 조금 물들인다. 라이트(화이트 시안): 불투명한 흰 블록
    todoCard: dark ? withAlpha(glassTint(card, rawAccent), 0.8) : card,
    todoCardSolid: dark ? glassTint(card, rawAccent) : card,
    cardPressed: mix(card, dark ? '#FFFFFF' : '#000000', 0.05),
    cardActive: mix(card, accent, dark ? 0.2 : 0.14),
    selection: withAlpha(accent, dark ? 0.55 : 0.4),
    // 입력창·하단바(화이트 시안): 옅은 회청색 알약 #EEF2F8 / #EDF3F8
    composer: dark ? mix(card, '#000000', 0.04) : '#EEF2F8',
    // 하단바(시안 #16191F): 카드보다 조금 어둡고 테마색 쪽으로 아주 살짝
    nav: dark ? mix(glassTint(card, rawAccent), '#000000', 0.14) : '#EDF3F8',
    raised: dark ? '#24282C' : '#E9ECF1',
    text: dark ? '#FFFFFF' : '#15171A',
    muted: dark ? '#929398' : '#7A7F87',
    /** 입력 안내 글자·날짜/시각처럼 조금 더 밝은 보조 글자 */
    subtle: dark ? '#BFC1C6' : '#6E737B',
    tab: dark ? '#C4C5CD' : '#80858D',
    circle: dark ? '#AEB0B5' : '#9AA0A8',
    outline: dark ? '#5A5E66' : '#B9BEC6',
    danger: '#FF6B6B',
    scale,
    zoom: ZOOM,
    // 미니창은 창(웹 문서)이 따로라 주소로 가른다
    desk,
    mini: onDesktop() && window.location.pathname.startsWith('/mini'),
    font: (size, extra) => ({
      fontSize: Math.round(size * scale * 10) / 10,
      fontWeight: weight,
      ...(family ? { fontFamily: family } : null),
      ...extra,
    }),
    kfont: (size, extra) => ({
      fontSize: Math.round(size * scale * KFONT * 10) / 10,
      fontWeight: weight,
      // 시안 글꼴보다 자간이 살짝 넓어 줄인다
      letterSpacing: -0.25,
      ...(family ? { fontFamily: family } : null),
      ...extra,
    }),
  };
}

/** 모든 입력칸 공통: 선택 하이라이트·커서·손잡이를 테마색으로 */
export function inputColors(t: Theme) {
  // underlineColorAndroid: 안드로이드 기본 밑줄이 테두리 상자 안에 비치지 않게
  return { selectionColor: t.selection, cursorColor: t.accent, selectionHandleColor: t.accent, underlineColorAndroid: 'transparent' } as const;
}
