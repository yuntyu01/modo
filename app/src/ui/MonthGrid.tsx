import { memo, useMemo, useState } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { useUi } from '../state/AppContext';
import { localDate, monthTitle, weekNames } from './format';
import { ChevronIcon } from './Icons';

/**
 * 달력(시안): 왼쪽 위 '2026년 10월', 오른쪽 ‹ ›(header=false면 머리 없이 — 캘린더 화면은 위에 따로 제목을 둔다). 앞뒤 달 날짜는 흐리게 채워 줄을 맞추고,
 * 고른 날은 강조색 동그라미, 오늘(고르지 않았을 때)은 강조색 굵은 숫자. 숫자 아래 점: 그날 끝낸 할 일이 있으면 테마색, 할 일만 있으면 옅은 색.
 * 날짜 칸을 좌우로 밀면 한 달씩 넘어가고, 넘어간 방향에서 새 달이 미끄러져 들어온다.
 */
export const MonthGrid = memo(function MonthGrid({
  month,
  setMonth,
  selected,
  onSelect,
  marks,
  doneMarks,
  header = true,
}: {
  month: Date;
  setMonth: (d: Date) => void;
  selected: string | null;
  onSelect: (date: string) => void;
  marks?: Set<string>;
  /** 그날 끝낸 할 일이 있는 날(점을 테마색으로) */
  doneMarks?: Set<string>;
  /** 달력 안 머리(연·월 + ‹ ›) */
  header?: boolean;
}) {
  const { theme, t, lang, today } = useUi();
  const weeks = useMemo(() => {
    const y = month.getFullYear();
    const m = month.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const total = Math.ceil((first + days) / 7) * 7;
    // 칸마다 날짜 글자·이번 달 여부·날을 한 번만 계산해 둔다(그릴 때마다 42칸을 다시 만들었다)
    const cells = Array.from({ length: total }, (_, i) => {
      const d = new Date(y, m, i - first + 1);
      return { d, k: localDate(d), inMonth: d.getMonth() === m, day: d.getDate() };
    });
    return Array.from({ length: total / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  }, [month]);
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  // 달이 바뀐 방향(다음 달 = 오른쪽에서 들어온다). 그리는 중에 바로 맞춘다
  const key = month.getFullYear() * 12 + month.getMonth();
  const [seen, setSeen] = useState({ key, dir: 0 });
  if (seen.key !== key) setSeen({ key, dir: key > seen.key ? 1 : -1 });
  const dir = seen.key !== key ? (key > seen.key ? 1 : -1) : seen.dir;
  // 좌우로 밀어 달 넘기기: 가로로 분명히 움직일 때만 가져온다(세로 스크롤·날짜 누르기는 그대로)
  const [swipe] = useState(() => {
    let go = shift;
    const pan = PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > 40) go(g.dx < 0 ? 1 : -1);
      },
      onPanResponderTerminationRequest: () => false,
    });
    return { pan, set: (f: typeof shift) => (go = f) };
  });
  swipe.set(shift);
  const slide = dir === 0 ? undefined : Platform.OS === 'web' ? (dir > 0 ? webSlide.fromRight : webSlide.fromLeft) : undefined;
  return (
    <View>
      {header ? (
        <View style={styles.head}>
          <Text style={theme.kfont(22, { color: theme.text, fontWeight: '700', flex: 1 })}>
            {/* 시안은 연·월 사이가 조금 더 벌어져 있다 */}
            {monthTitle(month, lang)
              .split(' ')
              .map((w, i) =>
                i ? (
                  <Text key={i}>
                    <Text style={{ letterSpacing: 3.5 }}> </Text>
                    {w}
                  </Text>
                ) : (
                  w
                ),
              )}
          </Text>
          <Pressable accessibilityLabel={t('prevMonth')} onPress={() => shift(-1)} hitSlop={12} style={[styles.arrow, { marginRight: 14 }]}>
            <ChevronIcon color={theme.subtle} dir="left" size={20} />
          </Pressable>
          <Pressable accessibilityLabel={t('nextMonth')} onPress={() => shift(1)} hitSlop={12} style={[styles.arrow, { marginRight: -7.5 }]}>
            <ChevronIcon color={theme.subtle} size={20} />
          </Pressable>
        </View>
      ) : null}
      <View {...swipe.pan.panHandlers}>
        <View style={[styles.week, styles.grid]}>
          {weekNames(lang).map((w) => (
            <Text key={w} style={[styles.cellText, theme.kfont(15, { color: theme.tab })]}>
              {w}
            </Text>
          ))}
        </View>
        <Animated.View key={key} entering={Platform.OS !== 'web' && dir ? (dir > 0 ? FadeInRight : FadeInLeft).duration(220) : undefined} style={slide}>
          {weeks.map((week, wi) => (
            <View key={wi} style={[styles.week, styles.grid]}>
              {week.map(({ d, k, inMonth, day }) => {
                const on = k === selected;
                return (
                  <Pressable
                    key={k}
                    onPress={() => {
                      if (!inMonth) setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                      onSelect(k);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={k}
                    style={styles.cell}
                  >
                    <View style={styles.day}>
                      {on ? (
                        <Svg width={SEL} height={SEL} style={StyleSheet.absoluteFill}>
                          <Circle cx={SEL / 2} cy={SEL / 2} r={SEL / 2} fill={theme.accent} />
                        </Svg>
                      ) : null}
                      <Text
                        style={theme.kfont(15.5, {
                          color: on ? theme.onAccent : k === today ? theme.accent : inMonth ? theme.text : theme.muted,
                          fontWeight: on || k === today ? '700' : '400',
                        })}
                      >
                        {day}
                      </Text>
                    </View>
                    {/* 숫자 아래 점(고른 날은 동그라미만): 끝낸 할 일이 있으면 테마색, 할 일만 있으면 옅은 색. SVG로(배경 둥글리기는 네모로 그려질 때가 있다) */}
                    {!on && (doneMarks?.has(k) || marks?.has(k)) ? (
                      <Svg width={DOT} height={DOT} style={styles.dot}>
                        <Circle cx={DOT / 2} cy={DOT / 2} r={DOT / 2} fill={doneMarks?.has(k) ? theme.accent : theme.subtle} />
                      </Svg>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Animated.View>
      </View>
    </View>
  );
});

// PC(웹): 달을 넘길 때 새 달이 옆에서 미끄러져 들어오는 움직임(휴대폰은 Reanimated의 entering)
const webSlide = StyleSheet.create({
  fromRight: {
    animationKeyframes: [{ '0%': { opacity: 0, transform: 'translateX(28px)' }, '100%': { opacity: 1, transform: 'translateX(0)' } }],
    animationDuration: '220ms',
    animationTimingFunction: 'ease-out',
  } as object,
  fromLeft: {
    animationKeyframes: [{ '0%': { opacity: 0, transform: 'translateX(-28px)' }, '100%': { opacity: 1, transform: 'translateX(0)' } }],
    animationDuration: '220ms',
    animationTimingFunction: 'ease-out',
  } as object,
});

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 19.5, marginBottom: 6 },
  arrow: { width: 24, height: 34, transform: [{ translateY: 1.5 }], alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row' },
  // 요일·날짜 칸은 달력 카드 안쪽을 거의 다 쓴다(시안: 칸 너비 약 49)
  grid: { paddingHorizontal: 6.5 },
  cellText: { flex: 1, textAlign: 'center', paddingVertical: 11 },
  // 캘린더 시안 비율: 줄 높이 48, 고른 날 동그라미 35
  cell: { flex: 1, alignItems: 'center', height: 48, justifyContent: 'center' },
  // 고른 날 동그라미는 SVG로 그린다(Android 새 렌더러는 칸 위치에 따라 반지름 절반짜리 배경을 네모로 그린다)
  day: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center' },
  // 할 일 점: 동그라미 바로 아래
  dot: { position: 'absolute', top: 42 },
});

const SEL = 35;
const DOT = 3.5;
