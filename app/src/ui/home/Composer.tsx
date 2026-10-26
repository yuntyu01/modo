import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { inputColors } from '../theme';
import type { FolderFilter } from '../../core/types';
import { useDrafts, useUi } from '../../state/AppContext';
import { mix } from '../color';
import { GlassBackground } from '../glass';
import { ArrowUpIcon, CheckSquareIcon, MemoNoteIcon } from '../Icons';
import { handleWebEnter } from '../webEnter';
import { MINI_RADIUS, useCardStyles } from './Cards';

type Props = {
  todoMode: boolean;
  setTodoMode: (v: boolean) => void;
  /** 초안을 직접 넘기거나(빠른 추가), draftFolder를 주면 그 폴더의 저장된 초안을 쓴다 */
  draft?: string;
  setDraft?: (v: string) => void;
  draftFolder?: FolderFilter;
  /** 입력 중(포커스 또는 초안 있음)이 바뀔 때만 알린다. 글자마다 부모를 다시 그리지 않으려고 */
  onComposingChange?: (composing: boolean) => void;
  /** 할 일 모드에서 글자가 있는지(목록의 미리보기 카드). 바뀔 때만 알린다 */
  onTypingChange?: (typing: boolean) => void;
  onSubmit: (todoMode: boolean, text: string) => Promise<boolean>;
  disabledReason?: string;
  onFocusChange?: (focused: boolean) => void;
  autoFocus?: boolean;
  /** 값이 바뀌면 입력창에 포커스(전체 보기에서 폴더를 골라 넘어왔을 때) */
  /** PC 미니창(시안): 덜 둥근 카드 모양, 토글 바탕 없음 */
  variant?: 'pill' | 'card';
  /** 카드형 입력칸 바탕(미니창: 메모·할 일과 같은 재질) */
  surface?: string;
};

/**
 * 입력창. 맨 오른쪽 체크 토글 하나로 할 일(ON)/메모 이어 쓰기(OFF)를 바꾼다.
 * - PC(큰 창·미니창, 시안): 토글 없이 늘 할 일. 메모는 빈 메모 칸을 누르면 메모 모드로 열리고, 쓰고 나거나 비운 채 나가면 할 일로 돌아온다.
 * - 초안은 폴더·모드마다 따로 보관(부모가 관리). 토글·폴더를 바꿔도 지우거나 자동 제출하지 않는다.
 * - 할 일: 키보드의 완료/엔터로 확정. 메모: 엔터는 줄바꿈, 보내기 버튼(데스크톱은 Ctrl+Enter)으로 확정.
 * - 한글 조합 중 엔터, 연달아 오는 제출 이벤트로 중복 추가되지 않게 막는다.
 */
export function Composer(props: Props) {
  const { todoMode, setTodoMode, onSubmit, disabledReason, onFocusChange, autoFocus, variant = 'pill', draftFolder, onComposingChange, surface } = props;
  const { theme, t, prefs, setPrefs } = useUi();
  // 입력창 높이: 예전 한 줄 카드 높이 그대로(카드 높이를 통일할 때 입력창은 유지)
  const cardH = useCardStyles().inputH;
  const drafts = useDrafts();
  const stored = draftFolder !== undefined;
  const draft = stored ? drafts.draftOf(draftFolder, todoMode) : (props.draft ?? '');
  const setDraft = (v: string) => (stored ? drafts.setDraftOf(draftFolder, todoMode, v) : props.setDraft?.(v));
  const input = useRef<TextInput>(null);
  const busy = useRef(false);
  const last = useRef({ text: '', at: 0 });
  const [focused, setFocused] = useState(false);
  const composing = focused || draft.length > 0;
  useEffect(() => onComposingChange?.(composing), [composing, onComposingChange]);
  const typing = todoMode && draft.trim().length > 0;
  const { onTypingChange } = props;
  useEffect(() => onTypingChange?.(typing), [typing, onTypingChange]);
  // PC(시안): 입력창에 할 일/메모 토글을 두지 않는다(토글 안내도 없음)
  const pc = theme.desk || theme.mini;
  const showHint = !pc && !prefs.hintSeen && focused;
  // 첫 사용 때만 잠깐 보여주고 다시는 띄우지 않는다.
  useEffect(() => {
    if (!showHint) return;
    const timer = setTimeout(() => setPrefs({ hintSeen: true }), 3500);
    return () => clearTimeout(timer);
  }, [showHint, setPrefs]);

  const backToTodo = () => {
    if (pc && !todoMode) setTodoMode(true);
  };

  const submit = async (raw?: string) => {
    const text = (raw ?? draft).replace(/\s+$/, '').replace(/^\n+/, '');
    if (!text.trim() || busy.current) return;
    const now = Date.now();
    if (last.current.text === text && now - last.current.at < 800) return;
    busy.current = true;
    last.current = { text, at: now };
    try {
      if (await onSubmit(todoMode, text)) {
        setDraft('');
        backToTodo();
      }
    } finally {
      busy.current = false;
    }
  };

  // 모드를 바꾼 뒤 입력칸에 커서를 둔다(키보드가 닫혀 있으면 열고, 열려 있으면 그대로). 커서는 그 모드 초안의 끝에
  const [caretSignal, setCaretSignal] = useState(0);
  useEffect(() => {
    if (!caretSignal) return;
    let again: ReturnType<typeof requestAnimationFrame> | null = null;
    const id = requestAnimationFrame(() => {
      const el = input.current as (TextInput & { setSelection?: (s: number, e: number) => void }) | null;
      if (!el) return;
      const caret = () => el.setSelection?.(draft.length, draft.length);
      if (!el.isFocused()) {
        el.focus();
        caret();
      } else if (Platform.OS !== 'web' && !Keyboard.isVisible()) {
        // Android 뒤로 가기로 키보드만 내린 상태: 포커스는 남아 있어 focus()만으로는 키보드가 다시 열리지 않는다.
        // 키보드가 닫혀 있을 때만 포커스를 놓았다가 다시 잡는다(열려 있으면 닫았다 열지 않고 그대로 둔다)
        el.blur();
        again = requestAnimationFrame(() => {
          el.focus();
          caret();
        });
      } else caret();
    });
    return () => {
      cancelAnimationFrame(id);
      if (again !== null) cancelAnimationFrame(again);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caretSignal]);

  const toggle = () => {
    // 모드를 바꿔도 초안을 지우거나 등록하지 않는다. 바꾼 쪽 초안이 비어 있으면 쓰던 글을 그대로 가져가고, 있으면 각자 보관한다(그 초안을 보여 준다).
    if (stored && draft && !drafts.draftOf(draftFolder, !todoMode)) {
      drafts.setDraftOf(draftFolder, !todoMode, draft);
      drafts.setDraftOf(draftFolder, todoMode, '');
    }
    setTodoMode(!todoMode);
    if (!disabledReason) setCaretSignal((n) => n + 1);
    if (!prefs.hintSeen) setPrefs({ hintSeen: true });
  };

  // 지금 모드의 아이콘 하나(휴대폰만): 할 일 = 체크 상자, 메모 = 메모지. 누르면 다른 모드로 바뀌고 바로 그 모드로 입력한다.
  // 둘 다 같은 크기·굵기·테마색. 지름 39의 옅은 테마색 동그라미 + 둘레로 넉넉히 눌리게
  const ModeIcon = todoMode ? CheckSquareIcon : MemoNoteIcon;
  const toggleButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={todoMode ? t('switchToMemo') : t('switchToTodo')}
      accessibilityHint={t('toggleHint')}
      onPress={toggle}
      hitSlop={8}
      style={[
        styles.toggle,
        variant === 'pill' && Platform.OS !== 'web' && { width: 39 * theme.zoom, height: 39 * theme.zoom, borderRadius: 19.5 * theme.zoom },
        variant === 'pill' && Platform.OS !== 'web' && { backgroundColor: mix(theme.composer, theme.accent, theme.dark ? 0.2 : 0.14) },
      ]}
    >
      <ModeIcon color={theme.accent} size={variant === 'card' ? 33 : 25 * theme.zoom} strokeWidth={1.9} />
    </Pressable>
  );

  return (
    <View>
      {showHint ? (
        <View style={[styles.hint, { backgroundColor: theme.raised }]} pointerEvents="none">
          <Text style={theme.font(13, { color: theme.text })}>{t('toggleHint')}</Text>
        </View>
      ) : null}
      <View
        style={[
          styles.bar,
          { backgroundColor: theme.composer, minHeight: (theme.desk ? 38 : 51) * theme.zoom * Math.min(theme.scale, 1.1) },
          // PC 큰 창: 옅은 하늘빛 입력칸, 오른쪽 끝에 테마색 보내기 버튼. 할 일 카드(48)보다 낮게(40)·모서리도 카드처럼 덜 둥글게(사용자 요청 2026-10-18)
          theme.desk && { minHeight: DESK_H * theme.scale, borderRadius: 12, paddingLeft: 16, paddingRight: 6, paddingVertical: 0, backgroundColor: theme.composer },
          // 휴대폰: 알약, 안내 글자는 조금 더 안쪽. 높이는 보조 줄 없는 할 일 카드와 같게
          Platform.OS !== 'web' && { minHeight: cardH, borderRadius: cardH / 2, paddingLeft: 21 * theme.zoom },
          variant === 'card' && { borderRadius: 16, minHeight: 52.7, paddingLeft: 25, paddingRight: 10.2, backgroundColor: theme.card },
          // 홈 입력창은 목록 위에 떠 있어 유리 바탕(뒤가 흐리게 비친다)
          variant === 'card' && surface ? { backgroundColor: surface } : null,
          // PC 미니창(시안): 할 일 블록과 같은 모서리, '+' 바보다 조금 높게
          theme.mini && variant === 'card' && { borderRadius: MINI_RADIUS, minHeight: 36, paddingLeft: 13 },
          // 휴대폰 홈 입력창은 목록 위에 떠 있어 유리 바탕(그림자 없이)
          variant === 'pill' && Platform.OS !== 'web' && styles.glass,
        ]}
      >
        {variant === 'pill' && Platform.OS !== 'web' ? <GlassBackground color={theme.composer} /> : null}
        <TextInput
          ref={input}
          autoFocus={autoFocus}
          value={draft}
        {...inputColors(theme)}
          onChangeText={setDraft}
          editable={!disabledReason}
          placeholder={disabledReason ?? (todoMode ? t('newTodo') : t('continueMemo'))}
          placeholderTextColor={theme.subtle}
          multiline
          submitBehavior={todoMode ? 'submit' : 'newline'}
          returnKeyType={todoMode ? 'done' : 'default'}
          enterKeyHint={todoMode ? 'done' : 'enter'}
          onSubmitEditing={todoMode ? (e) => submit(e.nativeEvent.text) : undefined}
          onKeyPress={(e) => {
            if (Platform.OS !== 'web') return;
            // 할 일: 엔터로 추가(PC는 직접 처리해야 줄바꿈이 안 된다). 메모: Ctrl+Enter로 추가
            if (todoMode) return void handleWebEnter(e, submit);
            const ne = e.nativeEvent as unknown as { key: string; isComposing?: boolean; ctrlKey?: boolean; metaKey?: boolean };
            if (ne.key === 'Enter' && (ne.ctrlKey || ne.metaKey) && !ne.isComposing) submit();
          }}
          onFocus={() => {
            setFocused(true);
            onFocusChange?.(true);
          }}
          onBlur={() => {
            setFocused(false);
            onFocusChange?.(false);
            if (!draft.trim()) backToTodo();
          }}
          style={[
            styles.input,
            theme.kfont((theme.mini ? 15 : 16) * theme.zoom, { color: theme.text }),
            Platform.OS === 'web' ? ({ outlineStyle: 'none', paddingTop: theme.desk ? 9 : 11, paddingBottom: theme.desk ? 9 : 11, lineHeight: 20 } as object) : null,
          ]}
          {...(Platform.OS === 'web' ? ({ rows: 1 } as object) : null)}
          maxLength={5000}
          accessibilityLabel={todoMode ? t('newTodo') : t('continueMemo')}
        />

        {theme.desk || (!todoMode && draft.trim()) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('add')}
            // 비어 있으면 입력칸으로(PC 큰 창은 시안처럼 보내기 버튼이 늘 보인다)
            onPress={() => (draft.trim() ? submit() : input.current?.focus())}
            hitSlop={6}
            style={[
              styles.send,
              { backgroundColor: theme.accent },
              theme.zoom !== 1 && { width: 34 * theme.zoom, height: 34 * theme.zoom, borderRadius: 17 * theme.zoom },
              theme.desk && { width: 28, height: 28, borderRadius: 8, marginRight: 0, marginLeft: 2 },
            ]}
          >
            <ArrowUpIcon color={theme.onAccent} size={theme.desk ? 16 : 18 * theme.zoom} />
          </Pressable>
        ) : null}
        {pc ? null : toggleButton}
      </View>
    </View>
  );
}

/** PC 큰 창 입력칸 높이(할 일 카드 48보다 낮게) */
const DESK_H = 40;

const styles = StyleSheet.create({
  // 테두리·그림자 없이 흐린 유리
  glass: { overflow: 'hidden', backgroundColor: 'transparent' },
  bar: {
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 9,
    paddingVertical: 5,
  },
  // position: 'relative': 웹에서 유리 바탕(절대 위치)이 입력칸을 덮지 않게 같은 쌓임 순서로
  input: { flex: 1, maxHeight: 120, paddingTop: 8, paddingBottom: 8, position: 'relative' },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  toggle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  hint: { position: 'absolute', right: 8, bottom: '100%', marginBottom: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
});
