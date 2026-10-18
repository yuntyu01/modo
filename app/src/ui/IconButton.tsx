import type { ReactNode, Ref } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useApp } from '../state/AppContext';

type Tip = 'below' | 'belowEnd' | 'left';

/**
 * 아이콘만 있는 버튼. PC(웹)에서는 마우스를 올리면 이름 말풍선(하단바와 같은 모양)을 띄우고, 접근성 이름도 같은 글로 둔다.
 * tip: 말풍선 자리. below(아래 가운데) · belowEnd(아래, 오른쪽 끝 맞춤: 창 오른쪽 끝 아이콘이 잘리지 않게) · left(왼쪽: 높이가 낮은 줄)
 */
export function IconButton({
  label,
  onPress,
  children,
  tip = 'below',
  style,
  hitSlop = 10,
  buttonRef,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  tip?: Tip;
  style?: StyleProp<ViewStyle>;
  hitSlop?: number;
  buttonRef?: Ref<View>;
}) {
  const { theme } = useApp();
  return (
    <Pressable ref={buttonRef} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={hitSlop} style={[styles.button, style]}>
      {(state) => (
        <>
          {children}
          {Platform.OS === 'web' && (state as { hovered?: boolean }).hovered ? (
            <View pointerEvents="none" style={[styles.anchor, ANCHOR[tip]]}>
              <View style={[styles.tip, { backgroundColor: theme.dark ? '#3A3D44' : '#2B2E33' }]}>
                <Text numberOfLines={1} style={theme.font(12, { color: '#FFFFFF' })}>
                  {label}
                </Text>
              </View>
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

const ANCHOR: Record<Tip, ViewStyle> = {
  below: { top: '100%', left: -80, right: -80, alignItems: 'center', marginTop: 6 },
  belowEnd: { top: '100%', right: -2, alignItems: 'flex-end', marginTop: 6 },
  left: { right: '100%', top: 0, bottom: 0, justifyContent: 'center', marginRight: 6 },
};

const styles = StyleSheet.create({
  // 아이콘 그림이 버튼 가운데에 오게
  button: { alignItems: 'center', justifyContent: 'center' },
  anchor: { position: 'absolute', zIndex: 30 },
  tip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7 },
});
