import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { createContext, useContext, type RefObject } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useUi } from '../state/AppContext';
import { withAlpha } from './color';

/**
 * 떠 있는 하단바·입력창의 바탕(휴대폰).
 * - 유리: 뒤의 목록을 흐리게 비추는 반투명 바탕(expo-blur). Android는 흐리게 할 대상(BlurTargetView, 메인 틀이 내용을 감싼다)을 알려 줘야 한다.
 *   그림자·테두리 없이 재질만으로 구분한다(화이트 시안).
 * - 아래쪽 페이드: 하단바·입력창 줄과 그 아래로 내려간 목록은 점점 희미해진다(BottomFade).
 */

export const BlurTargetContext = createContext<RefObject<View | null> | null>(null);

/** 둥근 블록 안쪽을 채우는 바탕. 부모는 overflow: 'hidden'과 같은 모서리를 가져야 한다. */
export function GlassBackground({ color }: { color: string }) {
  const { theme } = useUi();
  const target = useContext(BlurTargetContext);
  return (
    <>
      <BlurView
        style={StyleSheet.absoluteFill}
        intensity={Platform.OS === 'android' ? 100 : 60}
        tint={theme.dark ? 'dark' : 'light'}
        blurMethod="dimezisBlurViewSdk31Plus"
        blurTarget={target ?? undefined}
      />
      {/* 흐린 바탕 위에 바탕색을 얹어 글자가 묻히지 않게. 라이트(화이트 시안)는 거의 불투명한 옅은 회청색 */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(color, theme.dark ? 0.55 : 0.9) }]} />
    </>
  );
}

/** 화면 아래쪽에서 목록이 점점 희미해지는 막. 하단바·입력창보다 아래 층에, 목록보다 위 층에 둔다. */
export function BottomFade({ height }: { height: number }) {
  const { theme } = useUi();
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[withAlpha(theme.bg, 0), withAlpha(theme.bg, 0.72), withAlpha(theme.bg, 0.94)]}
      locations={[0, 0.45, 1]}
      style={[styles.fade, { height }]}
    />
  );
}

const styles = StyleSheet.create({
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
