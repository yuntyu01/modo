import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BRAND } from '../../brand';
import { useApp } from '../../state/AppContext';
import { luminance } from '../color';
import { CheckIcon } from '../Icons';
import { Logo } from '../Logo';
import { inputColors } from '../theme';
import type { Rect } from './coach';

/** 첫 실행 화면의 테마색 6개(시안: 파랑·라벤더·초록·살구·코랄·회색). 전체 팔레트(prefs.ts ACCENTS)에 있는 색이라 꾸미기에서도 선택이 이어진다 */
export const WELCOME_ACCENTS = [BRAND, '#B79CFF', '#5FD38D', '#FFA45B', '#FF7F6B', '#A7B0BE'];

/**
 * 첫 실행 화면(휴대폰): 테마색을 고르면 바로 위쪽 그라데이션과 로고 색이 바뀌고, 첫 할 일을 적어야 시작할 수 있다.
 * 비워 두고 '시작하기'를 누르면 첫 할 일 칸이 흔들리고 입력이 열린다. 적고 누르면 그 할 일을 저장하고(onStart),
 * 이 화면은 흐려지며 사라진다(onHidden). 홈의 안내(CoachOverlay)가 그 할 일과 입력창을 짚어 준다.
 */
export function Welcome({ onStart, onHidden, onLogin }: { onStart: (todoId: string, from: Rect | null) => void; onHidden: () => void; onLogin?: () => void }) {
  const { theme, t, prefs, setPrefs, repo, filter } = useApp();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [need, setNeed] = useState(false);
  const busy = useRef(false);
  const input = useRef<TextInput>(null);
  const field = useRef<View>(null);
  const scroll = useRef<ScrollView>(null);
  const [shake] = useState(() => new Animated.Value(0));
  const [fade] = useState(() => new Animated.Value(1));

  // 키보드가 열리면 첫 할 일 칸·안내·시작하기가 보이게 끝까지 내린다. 화면이 줄어든 뒤(onLayout)에 내려야 맞는다
  const kbOpen = useRef(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => {
      kbOpen.current = true;
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
    });
    const b = Keyboard.addListener('keyboardDidHide', () => (kbOpen.current = false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  const nudge = () => {
    setNeed(true);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    shake.setValue(0);
    Animated.sequence([-10, 10, -8, 8, -4, 4, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 45, useNativeDriver: true }))).start();
    input.current?.focus();
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 250);
  };

  const start = async () => {
    const v = text.trim();
    if (!v) return nudge();
    if (busy.current) return;
    busy.current = true;
    Keyboard.dismiss();
    const from = await new Promise<Rect | null>((res) =>
      field.current ? field.current.measureInWindow((x, y, w, h) => res(w > 0 ? { x, y, w, h } : null)) : res(null),
    );
    const id = await repo.addTodo(v, filter, prefs.newTodoAt);
    onStart(id, from);
    Animated.timing(fade, { toValue: 0, duration: 320, useNativeDriver: true }).start(() => onHidden());
  };

  const card = theme.todoCard;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg, opacity: fade, zIndex: 50 }]}>
      {/* 홈과 같은 위쪽 테마색 그라데이션: 색을 고르면 바로 바뀐다 */}
      <LinearGradient
        pointerEvents="none"
        colors={[theme.gradientTop, theme.gradientMid, theme.bg]}
        locations={theme.gradientStops}
        style={StyleSheet.absoluteFill}
      />
      {/* 키보드가 올라오면 첫 할 일 칸과 '시작하기'가 키보드 위로(홈 틀과 같이 Android도 padding: 창이 줄지 않는 기기가 있다) */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        <ScrollView
          ref={scroll}
          onLayout={() => kbOpen.current && scroll.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
          // 시작하기도 같은 흐름 안에(아래에 따로 고정해 두면 키보드가 뜰 때 첫 할 일 칸·안내를 덮었다: 사용자 지적 2026-10-18).
          // 화면이 길면 빈 자리(flex)만큼 아래로 내려가 맨 아래에 붙는다
          contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 18, paddingHorizontal: 22, paddingBottom: insets.bottom + 14 }}
        >
          <Logo height={19.5} color={theme.text} markColor={theme.mark} markRatio={0.83} wordStretch={1.06} />
          <Text style={theme.kfont(33, { color: theme.text, fontWeight: '700', lineHeight: 44, marginTop: 30 })}>{t('welcomeTitle')}</Text>
          <Text style={theme.kfont(16, { color: theme.muted, marginTop: 12 })}>{t('welcomeSub')}</Text>

          {/* 이렇게 쓰는 앱이에요: 메모 한 칸과 끝낸 할 일 하나 */}
          <View style={[styles.memo, { backgroundColor: card }]}>
            <Text style={theme.kfont(18, { color: theme.text, fontWeight: '600', lineHeight: 27 })}>{t('welcomeMemo')}</Text>
          </View>
          <View style={[styles.todo, { backgroundColor: card }]}>
            <View style={[styles.circle, { backgroundColor: theme.accent, borderColor: theme.accent }]}>
              <CheckIcon color={theme.onAccent} size={14} />
            </View>
            <Text style={theme.kfont(16, { color: theme.muted, textDecorationLine: 'line-through', flex: 1 })} numberOfLines={1}>
              {t('welcomeDoneTodo')}
            </Text>
          </View>

          <Text style={theme.kfont(14.5, { color: theme.subtle, marginTop: 28 })}>{t('welcomeTheme')}</Text>
          <View style={styles.swatches}>
            {WELCOME_ACCENTS.map((c, i) => {
              const on = prefs.accent.toUpperCase() === c.toUpperCase();
              return (
                <Pressable
                  key={c}
                  onPress={() => setPrefs({ accent: c })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${t('welcomeTheme')} ${i + 1}`}
                  hitSlop={4}
                  style={[styles.swatchRing, { borderColor: on ? theme.text : 'transparent' }]}
                >
                  <View style={[styles.swatch, { backgroundColor: c }]}>
                    {on ? <CheckIcon color={luminance(c) > 0.45 ? '#0B0C0E' : '#FFFFFF'} size={18} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Text style={theme.kfont(13, { color: theme.subtle, marginTop: 10 })}>{t('welcomeThemeNote')}</Text>

          <Text style={theme.kfont(14.5, { color: theme.subtle, marginTop: 26 })}>{t('welcomeFirstTodo')}</Text>
          <Animated.View
            ref={field}
            collapsable={false}
            style={[
              styles.field,
              { backgroundColor: card, borderColor: need && !text.trim() ? theme.danger : theme.outline, transform: [{ translateX: shake }] },
            ]}
          >
            <View style={[styles.circle, { borderColor: theme.circle }]} />
            <TextInput
              ref={input}
              {...inputColors(theme)}
              value={text}
              onChangeText={(v) => {
                setText(v);
                if (v.trim()) setNeed(false);
              }}
              placeholder={t('welcomePlaceholder')}
              placeholderTextColor={theme.muted}
              returnKeyType="done"
              onSubmitEditing={start}
              maxLength={300}
              accessibilityLabel={t('welcomeFirstTodo')}
              style={[theme.kfont(16.5, { color: theme.text }), styles.input]}
            />
          </Animated.View>
          {need && !text.trim() ? <Text style={theme.kfont(13, { color: theme.danger, marginTop: 10 })}>{t('welcomeNeedTodo')}</Text> : null}
          <View style={{ flex: 1, minHeight: 22 }} />
          <Pressable
            onPress={start}
            accessibilityRole="button"
            style={({ pressed }) => [styles.start, { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={theme.kfont(17, { color: theme.onAccent, fontWeight: '700' })}>{t('welcomeStart')}</Text>
          </Pressable>
          {onLogin ? (
            <Pressable onPress={onLogin} accessibilityRole="button" hitSlop={8} style={styles.login}>
              <Text style={theme.kfont(13.5, { color: theme.subtle })}>{t('welcomeHaveAccount')}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  memo: { borderRadius: 18, paddingHorizontal: 22, paddingVertical: 20, marginTop: 24 },
  todo: { borderRadius: 18, minHeight: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  circle: { width: 23, height: 23, borderRadius: 11.5, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  swatches: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  swatchRing: { width: 50, height: 50, borderRadius: 25, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  field: { borderRadius: 18, minHeight: 62, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', marginTop: 10, borderWidth: 1 },
  input: { flex: 1, paddingVertical: 14, paddingHorizontal: 0 },
  start: { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  login: { alignSelf: 'center', paddingTop: 12 },
});
