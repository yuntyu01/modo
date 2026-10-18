import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { parseDoneLog } from '../../core/doneLog';
import { addDays, matchesRule, ruleOf } from '../../core/repeat';
import type { Todo } from '../../core/types';
import { resolveLang } from '../../i18n';
import { desktop } from '../../native/bridge';
import { useApp } from '../../state/AppContext';
import { CalendarAdd } from '../../ui/CalendarAdd';
import { BottomFade } from '../../ui/glass';
import { useBottomInset, useWide } from '../../ui/layout';
import { ItemSheets, type SheetState } from '../../ui/ItemSheets';
import { MonthGrid } from '../../ui/MonthGrid';
import { TodoCard, type Editing } from '../../ui/home/Cards';
import { homeFolder, liveFolderIds, splitDone } from '../../ui/home/model';
import { LogoBar } from '../../ui/home/Header';
import { ChevronIcon, PlusIcon } from '../../ui/Icons';
import { dayTitle, localDate, monthName, monthTitle } from '../../ui/format';
import { Sheet } from '../../ui/primitives';

/**
 * 캘린더: 작은 로고 → 제목처럼 쓰는 '2026년 10월'(누르면 달 고르기, 다른 달을 보고 있으면 오른쪽 '오늘') → 달력 카드(좌우로 밀어 한 달씩)
 * → 고른 날짜 제목(오른쪽 작은 +) 과 그날 할 일 → 날짜 없는 할 일(오른쪽 '날짜 지정').
 * '캘린더' 제목과 ‹ ›는 두지 않는다(달력 모양과 하단바 선택으로 어떤 화면인지 보인다, 그만큼 할 일을 더 보이게: 사용자 요청 2026-10-18).
 * 할 일 추가는 날짜 옆 작은 +를 눌러 그 자리에 입력칸을 연다.
 * 모든 폴더의 할 일을 모아 보여 주고, 카드에는 원래 폴더 이름을 강조색으로 단다.
 */
export default function Calendar() {
  const { snap, theme, t, canWrite, prefs } = useApp();
  const { compact } = useWide();
  // 떠 있는 하단바가 덮는 아래쪽(스크롤 끝 여백, '할 일 추가'를 보이게 올릴 때 그만큼 덜 보인다고 본다)
  const navInset = useBottomInset();
  const inset = useRef(navInset);
  useEffect(() => {
    inset.current = navInset;
  }, [navInset]);
  const lang = resolveLang(prefs.language);
  const [month, setMonth] = useState(new Date());
  const [selected, setSelected] = useState(localDate(new Date()));
  const [editing, setEditing] = useState<Editing>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  // 날짜 옆 +: 누를 때마다 입력칸을 연다
  const [addSignal, setAddSignal] = useState(0);
  const today = localDate(new Date());
  const goToday = () => {
    setMonth(new Date());
    setSelected(today);
  };
  const [picker, setPicker] = useState(false);
  const [pickYear, setPickYear] = useState(month.getFullYear());
  const now = new Date();
  const awayFromToday = selected !== today || month.getFullYear() !== now.getFullYear() || month.getMonth() !== now.getMonth();
  // '할 일 추가' 칸에 입력하는 동안 그 칸이 키보드에 가리지 않게 스크롤한다.
  // 키보드가 열리면 화면이 줄어든 뒤(onLayout) 맞추고, 할 일을 추가해 칸이 아래로 밀려도 다시 맞춘다.
  const scroll = useRef<ScrollView>(null);
  const box = useRef({ addY: 0, addH: 0, viewH: 0, scrollY: 0, focused: false, pending: false });
  const revealAdd = () => {
    const b = box.current;
    b.pending = false;
    if (!b.viewH) return;
    const bottom = b.addY + b.addH + 16;
    const visible = b.viewH - inset.current;
    if (bottom > b.scrollY + visible) scroll.current?.scrollTo({ y: bottom - visible, animated: true });
    else if (b.addY < b.scrollY) scroll.current?.scrollTo({ y: Math.max(0, b.addY - 16), animated: true });
  };
  useEffect(() => {
    // 화면 크기가 안 바뀌는 경우(키보드가 이미 떠 있던 경우 등)를 위한 대비
    const sub = Keyboard.addListener('keyboardDidShow', () => setTimeout(() => box.current.pending && revealAdd(), 250));
    return () => sub.remove();
  }, []);

  // 캘린더의 반복 할 일은 날짜마다의 회차라, 이번 회차를 끝내 두었어도(목록에선 체크된 채 맨 아래) 다음 예정일 칸에는 할 일로 보인다
  const todos = useMemo(() => snap.todos.map((x) => (x.repeat_freq && x.done ? { ...x, done: false } : x)), [snap.todos]);
  const live = todos.filter((x) => !x.deleted_at && (prefs.showDone || !x.done));
  const liveIds = useMemo(() => liveFolderIds(snap.folders), [snap.folders]);
  const folderLabel = (folderId: string | null) => {
    const id = homeFolder(folderId, liveIds);
    return snap.folders.find((f) => f.id === id)?.name ?? t('baseFolder');
  };
  // 반복 할 일은 다음 예정일 뒤로도 규칙에 맞는 날마다 보여 준다(미리 보기라 체크·고치기는 예정일 당일 카드에서)
  const projected = (x: Todo, date: string) => {
    const rule = ruleOf(x);
    return !!rule && !!x.due_date && !x.done && date > x.due_date && matchesRule(rule, date, x.due_date);
  };
  const marks = useMemo(() => {
    const set = new Set(live.filter((x) => x.due_date).map((x) => x.due_date!));
    const repeats = live.filter((x) => x.repeat_freq && x.due_date && !x.done);
    if (repeats.length) {
      // 달력에 보이는 칸(앞뒤 달 포함 6주) 범위
      const first = localDate(new Date(month.getFullYear(), month.getMonth(), 1));
      for (let i = -7; i < 49; i++) {
        const d = addDays(first, i);
        if (repeats.some((x) => projected(x, d))) set.add(d);
      }
    }
    return set;
  }, [live, month]);
  // 그날 끝낸 할 일이 있는 날: 달력 점을 테마색으로. 보통 할 일은 끝낸 날, 루틴은 한 날 기록(done_log) 전부(기록이 없던 예전 루틴은 마지막으로 끝낸 날)
  const doneDays = useMemo(() => {
    const set = new Set<string>();
    for (const x of snap.todos) {
      if (x.deleted_at) continue;
      const log = x.repeat_freq ? parseDoneLog(x.done_log) : [];
      if (log.length) for (const d of log) set.add(d);
      else if (x.done_at != null) set.add(localDate(new Date(x.done_at)));
    }
    return set;
  }, [snap.todos]);
  const dayTodos = live.filter((x) => x.due_date === selected || projected(x, selected));
  // 오늘·지난 날의 루틴: 그날 했으면 체크된 채로, 지난 날 할 차례였는데 안 했으면 빈 동그라미로(보기만. 오늘 할 루틴은 위 목록에 이미 있다)
  const shown = new Set(dayTodos.map((x) => x.id));
  const routineLog =
    selected <= today
      ? snap.todos.flatMap((x) => {
          const rule = ruleOf(x);
          if (!rule || x.deleted_at || shown.has(x.id)) return [];
          const did = parseDoneLog(x.done_log).includes(selected);
          const due = selected < today && selected >= localDate(new Date(x.created_at)) && matchesRule(rule, selected, x.due_date ?? selected);
          return did || due ? [{ ...x, done: did }] : [];
        })
      : [];
  const day = splitDone([...dayTodos, ...routineLog]).flat();
  const undated = live.filter((x) => !x.due_date && !x.done);

  const card = (todo: (typeof live)[number], undatedRow = false) => {
    const writable = canWrite(todo.folder_id);
    return (
      <TodoCard
        key={todo.id}
        todo={todo}
        editing={editing}
        setEditing={setEditing}
        readOnly={!writable || (todo.due_date !== selected && !undatedRow)}
        onLongPress={() => setSheet({ type: 'todo', id: todo.id })}
        onInfo={() => setSheet({ type: 'todo', id: todo.id })}
        folderLabel={undatedRow ? undefined : folderLabel(todo.folder_id)}
        // 고른 날짜의 할 일은 날짜를 빼고 시간만. 날짜 없는 할 일은 알림 날짜까지 보여 준다(시간만 있으면 언제인지 모른다)
        hideDue={!undatedRow}
        onRepeatPress={writable ? () => setSheet({ type: 'repeat', id: todo.id }) : undefined}
        accessory={
          undatedRow && writable ? (
            <Pressable
              onPress={() => setSheet({ type: 'date', id: todo.id })}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`${todo.text} ${t('setDateShort')}`}
              style={{ marginLeft: 10 }}
            >
              <Text style={theme.kfont(13.5 * theme.zoom, { color: theme.subtle })}>{t('setDateShort')}</Text>
            </Pressable>
          ) : undefined
        }
      />
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {/* 맨 위 작은 로고, 그 아래 가운데에 제목처럼 '2026년 10월'(누르면 달 고르기) · 다른 달·날을 보고 있으면 오른쪽 끝 '오늘' */}
      <LogoBar />
      <View style={[styles.titleRow, { paddingTop: compact ? 2 : desktop ? 8 : 10 }]}>
        <Pressable
          onPress={() => {
            setPickYear(month.getFullYear());
            setPicker(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${monthTitle(month, lang)}, ${t('pickMonth')}`}
          hitSlop={8}
          style={styles.monthBtn}
        >
          <Text accessibilityRole="header" style={theme.kfont(compact ? 22 : desktop ? 24 : 26, { color: theme.text, fontWeight: '800' })}>
            {monthTitle(month, lang)}
          </Text>
        </Pressable>
        {awayFromToday ? (
          <Pressable onPress={goToday} accessibilityRole="button" hitSlop={10} style={[styles.todayBtn, styles.todayEnd]}>
            <Text style={theme.kfont(15, { color: theme.subtle })}>{t('today')}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 24 + navInset }]}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onScroll={(e) => (box.current.scrollY = e.nativeEvent.contentOffset.y)}
        onLayout={(e) => {
          box.current.viewH = e.nativeEvent.layout.height;
          if (box.current.pending) revealAdd();
        }}
      >
        <View style={[styles.cal, { backgroundColor: theme.todoCard }]}>
          <MonthGrid month={month} setMonth={setMonth} selected={selected} onSelect={setSelected} marks={marks} doneMarks={doneDays} header={false} />
        </View>
        {/* 고른 날짜: 제목 · (오늘이면) '오늘' · 오른쪽 작은 +(그 날짜에 할 일 추가) */}
        <View style={styles.dayRow}>
          <Text style={theme.kfont(20, { color: theme.text, fontWeight: '700' })}>{dayTitle(selected, lang)}</Text>
          {selected === today ? <Text style={theme.kfont(14.5, { color: theme.muted, marginLeft: 10 })}>{t('today')}</Text> : null}
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => setAddSignal((n) => n + 1)} accessibilityRole="button" accessibilityLabel={t('addTodoIn')} hitSlop={12} style={styles.dayPlus}>
            <PlusIcon color={theme.text} size={24} strokeWidth={1.6} />
          </Pressable>
        </View>
        {day.map((x) => card(x))}
        <CalendarAdd
          date={selected}
          hideIdle
          openSignal={addSignal}
          onLayout={(e) => {
            box.current.addY = e.nativeEvent.layout.y;
            box.current.addH = e.nativeEvent.layout.height;
            if (box.current.focused) revealAdd();
          }}
          onFocus={() => {
            box.current.focused = true;
            box.current.pending = true;
            if (Platform.OS === 'web' || Keyboard.isVisible()) revealAdd();
          }}
          onBlur={() => (box.current.focused = false)}
        />
        {undated.length ? (
          <>
            <Text style={[styles.section, styles.section2, theme.kfont(17, { color: theme.text, fontWeight: '600' })]}>{t('undated')}</Text>
            {undated.map((x) => card(x, true))}
          </>
        ) : null}
      </ScrollView>
      {navInset ? <BottomFade height={navInset + 28} /> : null}
      <ItemSheets state={sheet} setState={setSheet} />
      {/* 달 고르기: 연도(‹ ›) + 12달 */}
      <Sheet visible={picker} onClose={() => setPicker(false)}>
        <View style={styles.pickHead}>
          <Pressable onPress={() => setPickYear((y) => y - 1)} accessibilityLabel={t('prevYear')} hitSlop={12} style={styles.pickArrow}>
            <ChevronIcon color={theme.subtle} dir="left" size={22} />
          </Pressable>
          <Text style={theme.kfont(19, { color: theme.text, fontWeight: '700' })}>{pickYear}</Text>
          <Pressable onPress={() => setPickYear((y) => y + 1)} accessibilityLabel={t('nextYear')} hitSlop={12} style={styles.pickArrow}>
            <ChevronIcon color={theme.subtle} size={22} />
          </Pressable>
        </View>
        <View style={styles.pickGrid}>
          {Array.from({ length: 12 }, (_, i) => {
            const on = pickYear === month.getFullYear() && i === month.getMonth();
            const current = pickYear === now.getFullYear() && i === now.getMonth();
            return (
              <Pressable
                key={i}
                onPress={() => {
                  setMonth(new Date(pickYear, i, 1));
                  setPicker(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.pickCell, on && { backgroundColor: theme.accent }]}
              >
                <Text
                  style={theme.kfont(16, {
                    color: on ? theme.onAccent : current ? theme.accent : theme.text,
                    fontWeight: on || current ? '700' : '400',
                  })}
                >
                  {monthName(i + 1, lang)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, paddingBottom: 12 },
  monthBtn: { flexDirection: 'row', alignItems: 'center' },
  // '오늘'은 오른쪽 끝에 따로(제목은 늘 가운데)
  todayEnd: { position: 'absolute', right: 18, bottom: 12 },
  pickHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingTop: 22, paddingBottom: 10 },
  pickArrow: { paddingHorizontal: 18, paddingVertical: 6 },
  pickGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14, paddingBottom: 12 },
  pickCell: { width: '25%', height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  todayBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  dayRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 10, marginLeft: 1 },
  dayPlus: { padding: 4, marginRight: -2 },
  content: { paddingLeft: 19, paddingRight: 18, paddingBottom: 24 },
  // 달력 머리(연·월 · ‹ ›)는 위 제목으로 옮겨 카드 위쪽 여백만
  cal: { borderRadius: 16, paddingTop: 6, paddingBottom: 14 },
  section: { marginTop: 19.5, marginBottom: 8, marginLeft: 1 },
  section2: { marginTop: 15.5 },
});
