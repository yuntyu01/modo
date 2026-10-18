import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { resolveLang } from '../i18n';
import { useApp } from '../state/AppContext';
import { localDate, monthTitle, weekNames } from './format';
import { ChevronIcon } from './Icons';

/**
 * 달력(시안): 왼쪽 위 '2026년 10월', 오른쪽 ‹ ›. 앞뒤 달 날짜는 흐리게 채워 줄을 맞추고,
 * 고른 날은 강조색 동그라미, 오늘(고르지 않았을 때)은 강조색 굵은 숫자. 숫자 아래 점: 그날 끝낸 할 일이 있으면 테마색, 할 일만 있으면 옅은 색.
 */
export function MonthGrid({
  month,
  setMonth,
  selected,
  onSelect,
  marks,
  doneMarks,
}: {
  month: Date;
  setMonth: (d: Date) => void;
  selected: string | null;
  onSelect: (date: string) => void;
  marks?: Set<string>;
  /** 그날 끝낸 할 일이 있는 날(점을 테마색으로) */
  doneMarks?: Set<string>;
}) {
  const { theme, prefs, t } = useApp();
  const lang = resolveLang(prefs.language);
  const today = localDate(new Date());
  const weeks = useMemo(() => {
    const y = month.getFullYear();
    const m = month.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const total = Math.ceil((first + days) / 7) * 7;
    const cells = Array.from({ length: total }, (_, i) => new Date(y, m, i - first + 1));
    return Array.from({ length: total / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  }, [month]);
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  return (
    <View>
      <View style={styles.head}>
        <Text style={theme.kfont(22, { color: theme.text, fontWeight: '700', flex: 1 })}>
          {/* 시안은 연·월 사이가 조금 더 벌어져 있다 */}
          {monthTitle(month, lang).split(' ').map((w, i) => (i ? <Text key={i}><Text style={{ letterSpacing: 3.5 }}> </Text>{w}</Text> : w))}
        </Text>
        <Pressable accessibilityLabel={t('prevMonth')} onPress={() => shift(-1)} hitSlop={12} style={[styles.arrow, { marginRight: 14 }]}>
          <ChevronIcon color={theme.subtle} dir="left" size={20} />
        </Pressable>
        <Pressable accessibilityLabel={t('nextMonth')} onPress={() => shift(1)} hitSlop={12} style={[styles.arrow, { marginRight: -7.5 }]}>
          <ChevronIcon color={theme.subtle} size={20} />
        </Pressable>
      </View>
      <View style={[styles.week, styles.grid]}>
        {weekNames(lang).map((w) => (
          <Text key={w} style={[styles.cellText, theme.kfont(15, { color: theme.tab })]}>
            {w}
          </Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={[styles.week, styles.grid]}>
          {week.map((d) => {
            const k = localDate(d);
            const inMonth = d.getMonth() === month.getMonth();
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
                    {d.getDate()}
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
    </View>
  );
}

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
