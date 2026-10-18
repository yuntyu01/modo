import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { desktop } from '../native/bridge';
import { useApp } from '../state/AppContext';
import { ChevronIcon } from './Icons';
import { contentColumn, useTop } from './layout';
import { ToastHost } from './primitives';

/** 설정 하위 화면 틀: 뒤로 가기 + 제목, 상태바·내비게이션 영역을 피한다. */
export function SubScreen({
  title,
  children,
  footer,
  titleSize = 22,
  titleGap = 19.5,
  headerShift = -6.5,
  contentTop = 4,
  padLeft = 18,
  padRight = 18,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** 제목 글자 크기·뒤로 버튼과의 간격·위아래 위치(시안마다 조금씩 달라 화면별로 맞춘다) */
  titleSize?: number;
  titleGap?: number;
  headerShift?: number;
  contentTop?: number;
  /** 내용 좌우 여백(시안마다 0.5~1dp씩 다르다) */
  padLeft?: number;
  padRight?: number;
}) {
  const { theme, t } = useApp();
  const insets = useSafeAreaInsets();
  const top = useTop();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <LinearGradient pointerEvents="none" colors={[theme.gradientTop, theme.gradientMid, theme.bg]} locations={theme.gradientStops} style={StyleSheet.absoluteFill} />
      <View style={[styles.head, contentColumn, { paddingTop: desktop ? 40 : top + headerShift, gap: titleGap }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('cancel')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
          hitSlop={14}
          style={styles.back}
        >
          <ChevronIcon color={theme.text} dir="left" size={26} />
        </Pressable>
        <Text accessibilityRole="header" style={theme.kfont(titleSize, { color: theme.text, fontWeight: '700' })}>
          {title}
        </Text>
      </View>
      <KeyboardAvoidingView style={[{ flex: 1 }, contentColumn]} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingLeft: padLeft, paddingRight: padRight, paddingTop: contentTop, paddingBottom: insets.bottom + 32 }}
        >
          {children}
        </ScrollView>
        {footer}
      </KeyboardAvoidingView>
      <ToastHost bottom={insets.bottom + 24} />
    </View>
  );
}

export function Note({ children }: { children: ReactNode }) {
  const { theme } = useApp();
  return <Text style={theme.font(13, { color: theme.muted, lineHeight: 20, marginHorizontal: 12, marginBottom: 18 })}>{children}</Text>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12.5, paddingBottom: 18 },
  back: { padding: 4 },
});
