import { createContext, useContext } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** 넓은 화면(태블릿·가로·데스크톱)에서 본문 최대 너비. 그 이상은 가운데 정렬. */
// PC 큰 창(시안)은 가운데 좁은 단(약 446), 태블릿은 넓게
const CONTENT_MAX = Platform.OS === 'web' ? 481 : 680;

export function useWide() {
  const { width, height } = useWindowDimensions();
  // compact: 가로로 눕힌 폰처럼 높이가 낮을 때 제목·탭 여백을 줄여 목록 공간을 확보한다
  return { wide: width > CONTENT_MAX + 40, landscape: width > height, compact: height < 560, width, height };
}

/**
 * 화면 아래에 떠 있는 하단바가 덮는 높이(하단바 + 그 아래 여백, 키보드가 열려 하단바를 숨기면 0).
 * 목록·캘린더·더보기는 바닥까지 그리고, 스크롤 끝에 이만큼 여백을 둬 마지막 항목을 하단바 위로 올릴 수 있게 한다.
 */
export const BottomInsetContext = createContext(0);
export const useBottomInset = () => useContext(BottomInsetContext);

/** 본문 묶음에 쓰는 스타일: 화면이 넓어도 한 줄 길이가 지나치게 길어지지 않게 한다. */
export const contentColumn = { width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' } as const;

/**
 * 화면 위쪽 기준선. 시안(아이폰, 위쪽 안전 영역 59dp)과 같은 자리에서 내용이 시작되게
 * 상태바가 낮은 기기(Android 24~48dp)도 59dp까지 띄운다. 가로로 눕힌 낮은 화면은 실제 상태바만.
 */
const DESIGN_TOP = 59;
export function useTop() {
  const insets = useSafeAreaInsets();
  const { compact } = useWide();
  if (Platform.OS === 'web') return 0;
  return compact ? insets.top : Math.max(insets.top, DESIGN_TOP);
}
