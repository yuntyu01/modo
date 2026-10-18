import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dayBit, ruleOf, type RepeatFreq, type RepeatRule } from '../core/repeat';
import type { Todo } from '../core/types';
import { resolveLang } from '../i18n';
import { useApp } from '../state/AppContext';
import { formatDate, formatDue, localDate, parseLocalDate, weekNamesMonFirst } from './format';
import { CheckIcon, ChevronIcon, CloseIcon } from './Icons';
import { MonthGrid } from './MonthGrid';

type Freq = RepeatFreq | 'none';

/**
 * 반복 설정(시안): 아래에서 올라온 시트. 제목·할 일 → '반복' 줄(누르면 안 함/매일/매주/매월) →
 * 매주면 요일(고른 요일은 굵게 + 강조색 밑줄) → '시작일' 줄(누르면 달력) → 안내 → '적용하기'.
 * 적용 전까지는 아무것도 바꾸지 않는다.
 */
export function RepeatSheet({ todo, onClose }: { todo: Todo | undefined; onClose: () => void }) {
  return (
    <Modal visible={!!todo} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {todo ? <Body key={todo.id} todo={todo} onClose={onClose} /> : null}
    </Modal>
  );
}

function Body({ todo, onClose }: { todo: Todo; onClose: () => void }) {
  const { theme, t, prefs, repo, showToast } = useApp();
  const insets = useSafeAreaInsets();
  const lang = resolveLang(prefs.language);
  const today = localDate(new Date());
  const cur = ruleOf(todo);
  const [start, setStart] = useState(todo.due_date ?? today);
  // 처음 여는 할 일은 시안처럼 '매주' + 시작일의 요일로 시작한다(적용해야 저장된다)
  const [freq, setFreq] = useState<Freq>(cur?.freq ?? 'weekly');
  const [days, setDays] = useState(cur?.days || dayBit(start));
  const [open, setOpen] = useState<'freq' | 'start' | null>(null);
  const [month, setMonth] = useState(parseLocalDate(start));

  const dark = theme.dark;
  const sheetBg = dark ? '#1D2026' : '#FFFFFF';
  const rowBg = dark ? '#262A30' : '#F1F3F6';
  const names = weekNamesMonFirst(lang);
  const freqLabel: Record<Freq, string> = {
    none: t('repeatNone'),
    daily: t('repeatDaily'),
    weekly: t('repeatWeekly'),
    monthly: t('repeatMonthly'),
  };

  const apply = async () => {
    onClose();
    if (freq === 'none') {
      if (cur) await repo.setRepeat(todo.id, null, start);
      return;
    }
    const rule: RepeatRule = { freq, days: freq === 'weekly' ? days : null };
    await repo.setRepeat(todo.id, rule, start);
    // 시작일이 앞으로면 그날까지 폴더 화면에서 숨으니 언제 보이는지 알려 준다
    if (start > today) showToast({ message: t('repeatNext', { date: formatDue(start, lang) }) });
  };

  const row = (label: string, value: string, onPress: () => void, expanded: boolean) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded }} style={styles.row}>
      <Text style={theme.kfont(17, { color: theme.text, flex: 1 })}>{label}</Text>
      <Text style={theme.kfont(17, { color: theme.text, marginRight: 8, fontVariant: ['tabular-nums'] })}>{value}</Text>
      <ChevronIcon color={theme.subtle} size={18} dir={expanded ? 'down' : 'right'} />
    </Pressable>
  );

  return (
    <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('cancel')}>
      <Pressable style={[styles.sheet, { backgroundColor: sheetBg, paddingBottom: insets.bottom + 14 }]}>
        <View style={[styles.grabber, { backgroundColor: dark ? '#4A4E56' : '#C9CDD3' }]} />
        <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={theme.kfont(22.5, { color: theme.text, fontWeight: '700' })}>
                {t('repeatSettings')}
              </Text>
              <Text style={theme.kfont(16, { color: theme.subtle, marginTop: 5 })} numberOfLines={1}>
                {todo.text}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('cancel')} style={styles.close}>
              <CloseIcon color={theme.text} size={22} strokeWidth={1.9} />
            </Pressable>
          </View>

          <View style={[styles.card, { backgroundColor: rowBg }]}>
            {row(t('repeat'), freqLabel[freq], () => setOpen(open === 'freq' ? null : 'freq'), open === 'freq')}
            {open === 'freq'
              ? (['none', 'daily', 'weekly', 'monthly'] as Freq[]).map((f) => (
                  <Pressable
                    key={f}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: f === freq }}
                    onPress={() => {
                      setFreq(f);
                      setOpen(null);
                    }}
                    style={[styles.option, { borderTopColor: dark ? '#33373E' : '#E1E4E8' }]}
                  >
                    <Text style={theme.kfont(16.5, { color: f === freq ? theme.text : theme.subtle, flex: 1 })}>{freqLabel[f]}</Text>
                    {f === freq ? <CheckIcon color={theme.accent} size={18} /> : null}
                  </Pressable>
                ))
              : null}
          </View>

          {freq === 'weekly' ? (
            <>
              <Text style={[styles.label, theme.kfont(14.5, { color: theme.subtle })]}>{t('repeatWeekdays')}</Text>
              <View style={styles.week}>
                {names.map((n, i) => {
                  const on = (days & (1 << i)) !== 0;
                  return (
                    <Pressable
                      key={n}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={n}
                      hitSlop={6}
                      // 요일은 적어도 하나 남긴다
                      onPress={() => (on && days === 1 << i ? null : setDays(days ^ (1 << i)))}
                      style={styles.day}
                    >
                      <Text style={theme.kfont(18, { color: on ? theme.text : theme.muted, fontWeight: on ? '700' : '400' })}>{n}</Text>
                      <View style={[styles.underline, { backgroundColor: on ? theme.accent : 'transparent' }]} />
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {freq !== 'none' ? (
            <View style={[styles.card, { backgroundColor: rowBg, marginTop: freq === 'weekly' ? 22 : 14 }]}>
              {row(t('repeatStart'), formatDate(start, lang), () => setOpen(open === 'start' ? null : 'start'), open === 'start')}
              {open === 'start' ? (
                <View style={{ paddingBottom: 10 }}>
                  <MonthGrid
                    month={month}
                    setMonth={setMonth}
                    selected={start}
                    onSelect={(d) => {
                      setStart(d);
                      // 매주에서 요일을 아직 안 바꿨으면 새 시작일의 요일로 맞춘다
                      if (freq === 'weekly' && days === dayBit(start)) setDays(dayBit(d));
                      setOpen(null);
                    }}
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          <Text style={[styles.note, theme.kfont(15, { color: theme.subtle, lineHeight: 26 })]}>{t('repeatNote')}</Text>
        </ScrollView>
        <Pressable
          onPress={apply}
          accessibilityRole="button"
          style={({ pressed }) => [styles.apply, { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={theme.kfont(18, { color: theme.onAccent, fontWeight: '700' })}>{t('apply')}</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  // 시안: 화면 아래에 붙은 시트, 위쪽만 둥글게(PC 큰 창에서는 가운데 한 단)
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '92%', width: '100%', maxWidth: 560, alignSelf: 'center' },
  grabber: { width: 40, height: 4.5, borderRadius: 2.25, alignSelf: 'center', marginTop: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', paddingLeft: 22, paddingRight: 20, paddingTop: 26, paddingBottom: 22 },
  close: { marginTop: 4 },
  card: { marginHorizontal: 15, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 62, paddingLeft: 21, paddingRight: 17 },
  option: { flexDirection: 'row', alignItems: 'center', minHeight: 50, paddingLeft: 21, paddingRight: 19, borderTopWidth: StyleSheet.hairlineWidth },
  label: { marginLeft: 22, marginTop: 26, marginBottom: 12 },
  week: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 13 },
  day: { width: 44, alignItems: 'center' },
  underline: { width: 33, height: 3, borderRadius: 1.5, marginTop: 9 },
  note: { marginLeft: 22, marginRight: 22, marginTop: 26, marginBottom: 22 },
  apply: { marginHorizontal: 15, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
