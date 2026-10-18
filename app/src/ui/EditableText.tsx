import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Text, TextInput, type TextLayoutLine, type TextStyle } from 'react-native';

import { inputColors } from './theme';
import { useApp } from '../state/AppContext';
import { caretFromTap } from './caret';
import { useTextTip } from './textTip';
import { useWebLongPress } from './webLongPress';
import { handleWebEnter } from './webEnter';

type Props = {
  id: string;
  text: string;
  /** 편집 중이면 시작 커서 위치 */
  editing: { caret: number } | null;
  readOnly?: boolean;
  style: TextStyle;
  placeholder?: string;
  onStartEdit: (caret: number) => void;
  onEndEdit: () => void;
  onSave: (text: string) => Promise<unknown>;
  onLongPress?: () => void;
  /** 메모 문단: 줄바꿈 → 문단 나누기. 할 일: 없으면 엔터로 편집 끝 */
  onSplit?: (before: string, after: string[], caretInLast: number) => void;
  /** 문단 맨 앞에서 지우기 → 앞 문단과 합치기 */
  onMergeBack?: (text: string) => void;
  /**
   * 읽는 상태에서 보이는 최대 줄 수(넘치면 …). PC는 잘린 글에 마우스를 올리면 전체 글 말풍선.
   * 누르면 펼쳐진다: 고칠 수 있으면 편집(입력칸은 전체 글), 보기 전용이면 펼치기/접기
   */
  lines?: number;
};

/**
 * 읽을 때는 Text, 누르면 그 자리에 커서를 둔 TextInput으로 바뀐다.
 * 길게 누르기: 읽는 상태에선 항목 정보/끌기, 편집 중에는 OS 기본 글자 선택.
 * 저장은 0.5초 묶음 + 포커스 해제·백그라운드 전환 때 즉시.
 */
export function EditableText(p: Props) {
  const { registerFlush, sync, theme } = useApp();
  const lines = useRef<TextLayoutLine[] | null>(null);
  const input = useRef<TextInput>(null);
  const caret = useRef(0);
  const [draft, setDraft] = useState(p.text);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  // PC(웹): 입력칸(textarea)은 기본 2줄 높이라 편집을 시작하면 줄 사이가 벌어졌다. 1줄로 두고 내용 높이를 따라간다
  const [webH, setWebH] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(p.text);
  const savedRef = useRef(p.text);
  const editing = !!p.editing;
  // 보기 전용 글을 눌러 펼쳤는지(고칠 수 있는 글은 편집으로 펼쳐진다)
  const [open, setOpen] = useState(false);
  const { ref: tipRef, enter: tipEnter, hide: tipHide, node: tipNode } = useTextTip(p.text, Platform.OS === 'web' && !!p.lines && !open);
  // PC(웹): react-native-web의 Text는 onLongPress가 없어 정보 시트를 열 수 없었다.
  // 오른쪽 클릭, 또는 왼쪽 버튼을 0.5초 누르고 있으면 길게 누르기와 같은 동작을 한다(그 뒤 클릭은 편집으로 넘어가지 않는다).
  // 말풍선은 누르거나(편집·정보) 벗어나면 닫는다
  const webLong = useWebLongPress(p.onLongPress, { onDown: tipHide, onLeave: tipHide });
  const webLongProps = Platform.OS === 'web' ? { ...(webLong ?? { onMouseDown: tipHide, onMouseLeave: tipHide }), onMouseEnter: tipEnter } : null;
  // 편집 시작: 원본 글과 처음 커서로 초안을 맞춘다(그리는 중에 바로 맞춰 한 번 더 그리지 않게)
  const editKey = p.editing ? p.id : null;
  const [syncedKey, setSyncedKey] = useState<string | null>(null);
  if (editKey !== syncedKey) {
    setSyncedKey(editKey);
    if (p.editing) {
      const c = Math.min(p.editing.caret, p.text.length);
      setDraft(p.text);
      setSel({ start: c, end: c });
      setWebH(null);
    }
  }

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (draftRef.current !== savedRef.current) {
      savedRef.current = draftRef.current;
      await p.onSave(draftRef.current);
    }
  }, [p]);

  // 편집 시작: 저장 기준을 원본으로 두고 원격 반영을 미룬다.
  useEffect(() => {
    if (!p.editing) return;
    draftRef.current = savedRef.current = p.text;
    caret.current = Math.min(p.editing.caret, p.text.length);
    sync.beginEdit(p.id);
    const off = registerFlush(flush);
    // 키보드를 내리면 편집도 끝낸다(안드로이드는 키보드만 내려가고 포커스가 남는다).
    const kb = Keyboard.addListener('keyboardDidHide', () => input.current?.blur());
    return () => {
      off();
      kb.remove();
      flush().finally(() => sync.endEdit(p.id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, p.id]);

  const change = (next: string) => {
    if (p.onSplit && next.includes('\n')) {
      // 줄바꿈 뒤로 넘어간 글자 수 = 이전 글과 새 글의 공통 끝부분(선택 이벤트 순서에 기대지 않는다)
      const prev = draftRef.current;
      let tail = 0;
      const max = Math.min(prev.length, next.length);
      while (tail < max && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
      const parts = next.split('\n');
      const last = parts[parts.length - 1];
      draftRef.current = savedRef.current = parts[0];
      if (timer.current) clearTimeout(timer.current);
      p.onSplit(parts[0], parts.slice(1), Math.max(0, last.length - tail));
      return;
    }
    if (!p.onSplit && next.includes('\n')) next = next.replace(/\n+/g, ' ');
    draftRef.current = next;
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  };

  if (!editing) {
    return (
      <>
        <Text
          ref={tipRef as never}
          style={[p.style, !p.text && p.placeholder ? { color: theme.muted } : null]}
          numberOfLines={open ? undefined : p.lines}
          onTextLayout={(e) => (lines.current = e.nativeEvent.lines)}
          onPress={p.readOnly ? (p.lines ? () => setOpen((v) => !v) : undefined) : (e) => p.onStartEdit(caretFromTap(e, lines.current, p.text))}
          onLongPress={p.onLongPress}
          suppressHighlighting
          {...(webLongProps as object)}
        >
          {p.text || p.placeholder || ' '}
        </Text>
        {tipNode}
      </>
    );
  }
  return (
    <TextInput
      ref={input}
      {...inputColors(theme)}
      autoFocus
      value={draft}
      // 처음 커서만 지정하고 이후엔 OS에 맡긴다(제어형 selection은 0으로 지정할 때 무시되고 끝으로 가는 문제가 있었다).
      // 커서는 누른 자리(p.editing.caret)에서 바로 읽는다: 포커스가 위 이펙트보다 먼저 와서 ref가 아직 비어 있을 수 있다.
      // PC(웹)는 autoFocus로 포커스가 올 때 ref도 아직 비어 있어(커서를 못 두고 늘 줄 맨 앞에서 시작했다),
      // 포커스 이벤트의 입력칸(textarea)에 직접 setSelectionRange로 둔다. 포커스 직후 브라우저가 커서를 맨 앞으로 되돌리는 때가 있어
      // 다음 그리기와 조금 뒤에 한 번씩 더 맞춘다(그사이 사용자가 옮겼으면 건드리지 않는다).
      onFocus={(e) => {
        const c = Math.min(p.editing?.caret ?? caret.current, p.text.length);
        if (Platform.OS === 'web') {
          const el = ((e as unknown as { target?: unknown }).target ?? e.nativeEvent?.target) as
            { setSelectionRange?: (a: number, b: number) => void; selectionStart?: number; value?: string } | undefined;
          el?.setSelectionRange?.(c, c);
          const again = () => {
            const at = el?.selectionStart;
            if (at !== c && (at === 0 || at === el?.value?.length)) el?.setSelectionRange?.(c, c);
          };
          requestAnimationFrame(again);
          setTimeout(again, 60);
          return;
        }
        input.current?.setSelection(c, c);
      }}
      onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
      onChangeText={change}
      onKeyPress={(e) => {
        // 할 일: PC에서도 엔터로 편집 끝(웹은 blurAndSubmit을 몰라 공백이 들어갔다)
        if (!p.onSplit && handleWebEnter(e, () => input.current?.blur())) return;
        if (e.nativeEvent.key === 'Backspace' && sel.start === 0 && sel.end === 0 && p.onMergeBack) {
          if (timer.current) clearTimeout(timer.current);
          savedRef.current = draftRef.current;
          p.onMergeBack(draftRef.current);
        }
      }}
      onBlur={() => p.onEndEdit()}
      multiline
      submitBehavior={p.onSplit ? 'newline' : 'blurAndSubmit'}
      returnKeyType={p.onSplit ? 'default' : 'done'}
      scrollEnabled={false}
      onContentSizeChange={Platform.OS === 'web' ? (e) => setWebH(e.nativeEvent.contentSize.height) : undefined}
      {...(Platform.OS === 'web' ? ({ rows: 1 } as object) : null)}
      style={[
        p.style,
        { padding: 0, margin: 0, textAlignVertical: 'top' },
        Platform.OS === 'web' ? ({ outlineStyle: 'none', resize: 'none', overflow: 'hidden' } as object) : null,
        Platform.OS === 'web' && webH ? { height: webH } : null,
      ]}
      placeholder={p.placeholder}
      placeholderTextColor={theme.muted}
      underlineColorAndroid="transparent"
    />
  );
}
