import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type GestureResponderEvent, type TextLayoutLine, type TextStyle } from 'react-native';

import { toPlain } from '../core/rich';
import { useUi } from '../state/AppContext';
import { caretFromTap } from './caret';
import { linkPopover } from './LinkPopover';
import { RichEditor } from './RichEditor';
import { RichSpans } from './RichText';
import { useTextTip } from './textTip';
import { useWebLongPress } from './webLongPress';

type Props = {
  id: string;
  /** 저장된 글(꾸밈 태그 포함, core/rich.ts) */
  text: string;
  /** 편집 중이면 시작 커서 위치(태그를 뺀 글 기준) */
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
 * 읽을 때는 Text(굵게·밑줄·취소선·링크를 그대로), 누르면 그 자리에 커서를 둔 입력칸(RichEditor)으로 바뀐다.
 * 링크를 누르면 링크 말풍선(바로가기). 말풍선이 떠 있을 때 글을 다시 누르면 고치기(사용자 요청 2026-10-21).
 * 길게 누르기: 읽는 상태에선 항목 정보/끌기, 편집 중에는 OS 기본 글자 선택.
 * 저장은 0.5초 묶음 + 포커스 해제·백그라운드 전환 때 즉시.
 */
export function EditableText(p: Props) {
  const { registerFlush, sync, theme } = useUi();
  const lines = useRef<TextLayoutLine[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(p.text);
  const savedRef = useRef(p.text);
  const editing = !!p.editing;
  const plain = useMemo(() => toPlain(p.text), [p.text]);
  // 보기 전용 글을 눌러 펼쳤는지(고칠 수 있는 글은 편집으로 펼쳐진다)
  const [open, setOpen] = useState(false);
  const { ref: tipRef, enter: tipEnter, hide: tipHide, clipped: tipClipped, node: tipNode } = useTextTip(plain, Platform.OS === 'web' && !!p.lines && !open);
  // PC: 누른 자리를 글 전체에서 셀 때 기준이 되는 글 요소(꾸민 조각마다 글자 노드가 나뉜다)
  const textEl = useRef<unknown>(null);
  // 줄 수 제한으로 잘려 있는지. PC는 화면 요소로, 휴대폰은 같은 폭의 보이지 않는 글(줄 수 제한 없이)로 잰 전체 줄 수로
  // (Android는 줄 수를 제한한 글의 전체 줄 수를 알려 주지 않아 잘렸는지 몰랐다)
  const [fullLines, setFullLines] = useState(0);
  const measureFull = Platform.OS !== 'web' && !!p.lines && !open && plain.length > 10;
  const clipped = () => {
    if (!p.lines || open) return false;
    if (Platform.OS === 'web') return tipClipped();
    return fullLines > p.lines;
  };
  // PC(웹): react-native-web의 Text는 onLongPress가 없어 정보 시트를 열 수 없었다.
  // 오른쪽 클릭, 또는 왼쪽 버튼을 0.5초 누르고 있으면 길게 누르기와 같은 동작을 한다(그 뒤 클릭은 편집으로 넘어가지 않는다).
  // 말풍선은 누르거나(편집·정보) 벗어나면 닫는다
  const webLong = useWebLongPress(p.onLongPress, { onDown: tipHide, onLeave: tipHide });
  const webLongProps = Platform.OS === 'web' ? { ...(webLong ?? { onMouseDown: tipHide, onMouseLeave: tipHide }), onMouseEnter: tipEnter } : null;
  // 편집 시작: 잘린 글을 펼쳐 둔 것은 고치고 나면 다시 줄 수 제한으로
  const editKey = p.editing ? p.id : null;
  const [syncedKey, setSyncedKey] = useState<string | null>(null);
  if (editKey !== syncedKey) {
    setSyncedKey(editKey);
    if (p.editing) setOpen(false);
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
    sync.beginEdit(p.id);
    linkPopover.close();
    const off = registerFlush(flush);
    return () => {
      off();
      flush().finally(() => sync.endEdit(p.id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, p.id]);

  const tapCaret = (e: GestureResponderEvent) => caretFromTap(e, lines.current, plain, textEl.current);
  const startEdit = (e: GestureResponderEvent) => (clipped() ? setOpen(true) : p.onStartEdit(tapCaret(e)));
  // 링크: 처음 누르면 말풍선, 말풍선이 떠 있을 때(이번 손짓에 닫혔으면) 다시 누르면 고치기
  const onLink = (href: string, e: GestureResponderEvent) => {
    tipHide();
    if (linkPopover.justClosed(p.id)) {
      if (!p.readOnly) startEdit(e);
      return;
    }
    linkPopover.show({ key: p.id, href, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
  };
  const struck = p.style.textDecorationLine === 'line-through';

  if (!editing) {
    return (
      <>
        <Text
          ref={(el) => {
            textEl.current = el;
            (tipRef as (v: unknown) => void)(el);
          }}
          style={[p.style, !plain && p.placeholder ? { color: theme.muted } : null]}
          numberOfLines={open ? undefined : p.lines}
          onTextLayout={(e) => (lines.current = e.nativeEvent.lines)}
          // 잘린 긴 글: 처음 누르면 여러 줄로 펼치고, 펼친 뒤 누르면 그 자리에서 고치기(사용자 요청 2026-10-18). 보기 전용은 펼치기/접기
          onPress={p.readOnly ? (p.lines ? () => setOpen((v) => !v) : undefined) : startEdit}
          onLongPress={p.onLongPress}
          suppressHighlighting
          {...(webLongProps as object)}
        >
          {plain ? <RichSpans src={p.text} onLink={onLink} struck={struck} /> : p.placeholder || ' '}
        </Text>
        {measureFull ? (
          // 보이지 않는 글이 위에 겹쳐 있어 터치를 가로채지 않게 View로 감싼다(Android Text는 pointerEvents를 따르지 않아
          // 10자 넘는 제목은 눌러도 고치기·길게 누르기가 안 됐다)
          <View pointerEvents="none" style={styles.measure} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={p.style} onTextLayout={(e) => setFullLines(e.nativeEvent.lines.length)}>
              <RichSpans src={p.text} />
            </Text>
          </View>
        ) : null}
        {tipNode}
      </>
    );
  }
  return (
    <RichEditor
      initial={p.text}
      caret={Math.min(p.editing!.caret, plain.length)}
      style={p.style}
      placeholder={p.placeholder}
      onChange={(markup) => {
        draftRef.current = markup;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, 500);
      }}
      onSplit={
        p.onSplit
          ? (before, after, caret) => {
              // 앞 조각은 나누기가 저장한다(여기서 또 저장하지 않게)
              if (timer.current) clearTimeout(timer.current);
              draftRef.current = savedRef.current = before;
              p.onSplit!(before, after, caret);
            }
          : undefined
      }
      onMergeBack={
        p.onMergeBack
          ? (markup) => {
              if (timer.current) clearTimeout(timer.current);
              draftRef.current = savedRef.current = markup;
              p.onMergeBack!(markup);
            }
          : undefined
      }
      onEnd={p.onEndEdit}
    />
  );
}

const styles = StyleSheet.create({
  // 잘렸는지 재는 보이지 않는 글: 같은 자리·같은 폭, 화면에는 안 보이고 누를 수도 없다
  measure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
});
