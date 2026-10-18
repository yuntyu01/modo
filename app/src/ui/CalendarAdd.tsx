import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';

import { useApp } from '../state/AppContext';
import { useCardStyles } from './home/Cards';
import { ChevronIcon, PlusIcon } from './Icons';
import { Sheet, SheetButton, SheetTitle } from './primitives';
import { inputColors } from './theme';
import { handleWebEnter } from './webEnter';

type Props = {
  /** 캘린더에서 고른 날짜(YYYY-MM-DD). 추가한 할 일에 이 날짜가 붙는다 */
  date: string;
  onLayout?: (e: LayoutChangeEvent) => void;
  /** 입력을 시작하면(키보드에 가리지 않게 부모가 스크롤) */
  onFocus?: () => void;
  onBlur?: () => void;
  /** 값이 바뀌면 입력칸을 연다(날짜 옆 작은 +) */
  openSignal?: number;
  /** 닫혀 있을 때 '할 일 추가' 줄을 그리지 않는다(+로만 연다) */
  hideIdle?: boolean;
};

/**
 * 캘린더의 고른 날짜 목록 바로 밑 '할 일 추가' 줄. 누르면 그 자리가 입력칸이 되고,
 * 엔터(완료)로 고른 날짜의 할 일을 만든 뒤 바로 다음 것을 이어 쓸 수 있다.
 * 저장할 폴더는 지금 홈에서 보던 폴더(쓸 수 없으면 기본)로 시작하고, 입력칸 오른쪽에 보여 주며 눌러 바꾼다.
 * 홈 입력창처럼 초안은 지우지 않고(자동 제출 X), 한글 조합 중 엔터로 두 번 추가되지 않게 막는다.
 */
export function CalendarAdd({ date, onLayout, onFocus, onBlur, openSignal, hideIdle }: Props) {
  const { theme, t, repo, prefs, filter, snap, canWrite } = useApp();
  const st = useCardStyles();
  const right = prefs.checkSide === 'right';
  const [open, setOpen] = useState(false);
  // 날짜 옆 +를 누르면 열린다(그리는 중에 바로 맞춰 한 번 더 그리지 않게)
  const [seenSignal, setSeenSignal] = useState(openSignal);
  if (seenSignal !== openSignal) {
    setSeenSignal(openSignal);
    if (openSignal) setOpen(true);
  }
  const [text, setText] = useState('');
  const [pick, setPick] = useState(false);
  const input = useRef<TextInput>(null);
  // 키보드 이벤트 안에서 최신 값을 보려고
  const textRef = useRef('');
  const change = (v: string) => {
    textRef.current = v;
    setText(v);
  };
  const picking = useRef(false);
  const sheetOpen = useRef(false);
  // Android 뒤로 가기로 키보드만 내리면 입력칸이 포커스를 쥔 채 남는다. 비어 있으면 '할 일 추가' 줄로 되돌린다(폴더 고르는 중은 제외).
  useEffect(() => {
    if (!open || Platform.OS === 'web') return;
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      if (picking.current || textRef.current.trim()) return;
      input.current?.blur();
      setOpen(false);
    });
    return () => sub.remove();
  }, [open]);
  const busy = useRef(false);
  const last = useRef({ text: '', at: 0 });

  const folders = snap.folders.filter((f) => !f.deleted_at && canWrite(f.id));
  const startFolder = filter && folders.some((f) => f.id === filter) ? filter : null;
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  // 고른 폴더가 지워졌거나 권한이 없어지면 처음 폴더로
  const folder = chosen !== undefined && (chosen === null || folders.some((f) => f.id === chosen)) ? chosen : startFolder;
  const folderName = folders.find((f) => f.id === folder)?.name ?? t('baseFolder');

  const submit = async (raw: string) => {
    const value = raw.replace(/\s+$/, '').replace(/^\s+/, '');
    if (!value || busy.current) return;
    const now = Date.now();
    if (last.current.text === value && now - last.current.at < 800) return;
    busy.current = true;
    last.current = { text: value, at: now };
    try {
      await repo.addTodo(value, folder, prefs.newTodoAt, date);
      change('');
    } finally {
      busy.current = false;
    }
  };

  // 할 일 카드와 글자 시작이 맞게 동그라미 자리·여백도 같은 배율로(theme.zoom)
  const z = theme.zoom;
  const plus = (
    <View style={[styles.icon, { width: 28 * z * theme.scale }, right ? { marginLeft: 20 * z } : { marginRight: 20 * z }]}>
      <PlusIcon color={theme.accent} size={22 * z * theme.scale} strokeWidth={1.9} />
    </View>
  );
  const pad = right ? { paddingLeft: 22 * z, paddingRight: 17.5 * z } : { paddingLeft: 17.5 * z, paddingRight: 16 * z };

  return (
    <View onLayout={onLayout}>
      {open ? (
        <View style={[styles.card, { borderColor: theme.outline, minHeight: st.inputH, marginBottom: st.gap }, pad]}>
          {!right && plus}
          <TextInput
            ref={input}
            autoFocus
            value={text}
            onChangeText={change}
            {...inputColors(theme)}
            placeholder={t('newTodo')}
            placeholderTextColor={theme.subtle}
            multiline
            submitBehavior="submit"
            returnKeyType="done"
            enterKeyHint="done"
            onSubmitEditing={(e) => submit(e.nativeEvent.text)}
            onKeyPress={(e) => {
              if (Platform.OS !== 'web') return;
              if (e.nativeEvent.key === 'Escape') input.current?.blur();
              else handleWebEnter(e, submit);
            }}
            onFocus={onFocus}
            onBlur={() => {
              onBlur?.();
              // 쓰던 글이 있으면 그대로 두고(자동 저장·삭제 X), 비어 있으면 다시 '할 일 추가' 줄로.
              // PC는 폴더 버튼을 누르는 순간 입력칸이 먼저 포커스를 잃으므로 조금 기다렸다가 폴더 고르는 중이 아니면 닫는다.
              setTimeout(() => {
                if (!picking.current && !textRef.current.trim()) setOpen(false);
              }, 200);
            }}
            style={[
              st.text,
              styles.input,
              Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
            ]}
            {...(Platform.OS === 'web' ? ({ rows: 1 } as object) : null)}
            maxLength={5000}
            accessibilityLabel={t('addTodoIn')}
          />
          <Pressable
            onPressIn={() => {
              picking.current = true;
              // 누르다 말고 손을 떼면(시트 안 열림) 원래대로
              setTimeout(() => !sheetOpen.current && (picking.current = false), 800);
            }}
            onPress={() => {
              picking.current = sheetOpen.current = true;
              setPick(true);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${t('folder')} ${folderName}`}
            style={styles.folder}
          >
            <Text style={theme.kfont(13.5 * z, { color: theme.accent })} numberOfLines={1}>
              {folderName}
            </Text>
            <ChevronIcon color={theme.accent} size={13 * z} dir="down" />
          </Pressable>
          {right && plus}
        </View>
      ) : hideIdle ? null : (
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('addTodoIn')}
          style={({ pressed }) => [
            styles.card,
            { borderColor: theme.outline, minHeight: st.inputH, marginBottom: st.gap },
            pressed && { backgroundColor: theme.cardPressed },
            pad,
          ]}
        >
          {!right && plus}
          <Text style={[st.text, { color: theme.subtle, flex: 1 }]}>{t('addTodoIn')}</Text>
          {right && plus}
        </Pressable>
      )}

      <Sheet
        visible={pick}
        onClose={() => {
          setPick(false);
          sheetOpen.current = false;
          setTimeout(() => (picking.current = false), 600);
        }}
      >
        <SheetTitle title={t('pickFolderToAdd')} />
        {[{ id: null as string | null, name: t('baseFolder') }, ...folders.map((f) => ({ id: f.id as string | null, name: f.name }))].map((f) => (
          <SheetButton
            key={f.id ?? 'base'}
            label={f.name}
            selected={f.id === folder}
            onPress={() => {
              setPick(false);
              sheetOpen.current = false;
              setChosen(f.id);
              setTimeout(() => input.current?.focus(), 250);
              setTimeout(() => (picking.current = false), 600);
            }}
          />
        ))}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  // 홈의 새 할 일 미리보기처럼 얇은 실선 카드(저장 전 자리)
  card: { borderRadius: 14.5, borderWidth: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent' },
  icon: { alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, maxHeight: 120, paddingTop: 12, paddingBottom: 12, paddingHorizontal: 0 },
  folder: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 10, maxWidth: 120 },
});
