import { useEffect, useRef, useState } from 'react';
import { Keyboard, Text, TextInput } from 'react-native';

import {
  allMarked,
  applyPlainEdit,
  linkOf,
  normalizeUrl,
  parseRich,
  plainOf,
  serializeRich,
  setLink,
  splitRunsByLine,
  toggleMark,
  type Mark,
  type Run,
} from '../core/rich';
import { useUi } from '../state/AppContext';
import { FormatBar, useFormatBar, type Linking } from './FormatBar';
import type { RichEditorProps } from './richEditorProps';
import { markStyle } from './RichText';
import { inputColors } from './theme';

type Sel = { start: number; end: number };
const order = (s: Sel) => ({ start: Math.min(s.start, s.end), end: Math.max(s.start, s.end) });

/**
 * 휴대폰 입력칸: 꾸민 조각을 TextInput 안의 Text로 그대로 보여 준다(굵게·밑줄·취소선·링크색).
 * 글자를 끌어 고르면 키보드 위에 꾸미기 막대(FormatBar). 고른 글 위에 주소를 붙여 넣으면 그 글이 링크가 된다(PC의 Ctrl+V와 같다).
 */
export function RichEditor(p: RichEditorProps) {
  const { theme } = useUi();
  const input = useRef<TextInput>(null);
  const [runs, setRuns] = useState<Run[]>(() => parseRich(p.initial));
  const runsRef = useRef(runs);
  const sel = useRef<Sel>({ start: p.caret, end: p.caret });
  const [range, setRange] = useState<Sel>({ start: p.caret, end: p.caret });
  const [linking, setLinkingState] = useState<(Linking & Sel) | null>(null);
  const linkingRef = useRef(linking);
  const setLinking = (v: (Linking & Sel) | null) => {
    linkingRef.current = v;
    setLinkingState(v);
  };
  // 링크 주소 칸으로 포커스가 옮겨 가는 동안은 입력칸을 벗어나도 편집을 끝내지 않는다
  const hold = useRef(false);
  const end = useRef(p.onEnd);
  useEffect(() => {
    end.current = p.onEnd;
  });

  // 편집을 시작한 뒤 아직 고치지 않았는데 글이 바뀌어 오면(문단 합치기: 저장이 화면보다 먼저 끝난다) 새 글로.
  // 예전엔 합치기 전 글로 열려, 이어서 엔터를 치면 합쳐 온 글이 지워졌다
  const base = useRef<string | null>(null);
  useEffect(() => {
    const cur = serializeRich(runsRef.current);
    if (base.current === null) base.current = cur;
    const next = serializeRich(parseRich(p.initial));
    if (next === cur) {
      base.current = next;
      return;
    }
    if (cur !== base.current) return;
    const runs = parseRich(p.initial);
    runsRef.current = runs;
    base.current = next;
    setRuns(runs);
  }, [p.initial]);

  const commit = (next: Run[]) => {
    runsRef.current = next;
    setRuns(next);
    p.onChange(serializeRich(next));
  };

  useEffect(() => {
    // 키보드를 내리면 편집도 끝낸다(안드로이드는 키보드만 내려가고 포커스가 남는다). 링크 주소를 넣다 내려도 끝
    const kb = Keyboard.addListener('keyboardDidHide', () => {
      if (linkingRef.current) {
        hold.current = false;
        setLinking(null);
        end.current();
        return;
      }
      input.current?.blur();
    });
    return () => kb.remove();
  }, []);

  const change = (next: string) => {
    const prev = plainOf(runsRef.current);
    const s = order(sel.current);
    // 고른 글 위에 주소(https://…, www.…)를 붙여 넣으면: 글은 그대로 두고 링크로
    if (s.end > s.start && next.startsWith(prev.slice(0, s.start)) && next.endsWith(prev.slice(s.end))) {
      const pasted = next.slice(s.start, next.length - (prev.length - s.end)).trim();
      const href = /^(https?:\/\/|www\.)\S+$/i.test(pasted) ? normalizeUrl(pasted) : null;
      if (href) {
        commit(setLink(runsRef.current, s.start, s.end, href));
        requestAnimationFrame(() => input.current?.setSelection(s.end, s.end));
        return;
      }
    }
    if (p.onSplit && next.includes('\n')) {
      // 줄바꿈 뒤로 넘어간 글자 수 = 이전 글과 새 글의 공통 끝부분(선택 이벤트 순서에 기대지 않는다)
      let tail = 0;
      const max = Math.min(prev.length, next.length);
      while (tail < max && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
      const parts = splitRunsByLine(applyPlainEdit(runsRef.current, next, sel.current));
      const last = plainOf(parts[parts.length - 1]);
      p.onSplit(serializeRich(parts[0]), parts.slice(1).map(serializeRich), Math.max(0, last.length - tail));
      return;
    }
    if (!p.onSplit && next.includes('\n')) next = next.replace(/\n+/g, ' ');
    commit(applyPlainEdit(runsRef.current, next, sel.current));
  };

  const toggle = (k: Mark) => {
    const { start, end: e } = order(sel.current);
    if (e <= start) return;
    commit(toggleMark(runsRef.current, start, e, k));
    requestAnimationFrame(() => input.current?.setSelection(start, e));
  };
  const startLink = () => {
    const { start, end: e } = order(sel.current);
    if (e <= start) return;
    hold.current = true;
    setLinking({ start, end: e, href: linkOf(runsRef.current, start, e) ?? '' });
  };
  const linkDone = (href: string | null | undefined) => {
    const l = linkingRef.current;
    setLinking(null);
    if (l && href !== undefined) commit(setLink(runsRef.current, l.start, l.end, href));
    input.current?.focus();
    setTimeout(() => {
      hold.current = false;
      // 넣었으면 링크 끝에 커서, 그만뒀으면 고른 글 그대로
      if (l) input.current?.setSelection(href === undefined ? l.start : l.end, l.end);
    }, 60);
  };

  const r = order(range);
  const selected = r.end > r.start;
  useFormatBar(
    selected || linking ? (
      <FormatBar
        active={{
          b: allMarked(runs, r.start, r.end, 'b'),
          u: allMarked(runs, r.start, r.end, 'u'),
          s: allMarked(runs, r.start, r.end, 's'),
          a: allMarked(runs, r.start, r.end, 'a'),
        }}
        onToggle={toggle}
        onLink={startLink}
        linking={linking}
        onLinkDone={linkDone}
      />
    ) : null,
  );

  return (
    <TextInput
      ref={input}
      {...inputColors(theme)}
      autoFocus
      // 처음 커서만 지정하고 이후엔 OS에 맡긴다(제어형 selection은 0으로 지정할 때 무시되고 끝으로 가는 문제가 있었다)
      onFocus={() => {
        if (hold.current) return;
        const c = Math.min(p.caret, plainOf(runsRef.current).length);
        if (sel.current.start === p.caret && sel.current.end === p.caret) input.current?.setSelection(c, c);
      }}
      onSelectionChange={(e) => {
        sel.current = e.nativeEvent.selection;
        setRange(e.nativeEvent.selection);
      }}
      onChangeText={change}
      onKeyPress={(e) => {
        const s = sel.current;
        if (e.nativeEvent.key === 'Backspace' && s.start === 0 && s.end === 0 && p.onMergeBack) p.onMergeBack(serializeRich(runsRef.current));
      }}
      onBlur={() => {
        if (!hold.current) p.onEnd();
      }}
      multiline
      submitBehavior={p.onSplit ? 'newline' : 'blurAndSubmit'}
      returnKeyType={p.onSplit ? 'default' : 'done'}
      scrollEnabled={false}
      style={[
        p.style,
        { padding: 0, margin: 0, textAlignVertical: 'top' },
        // Android는 빈 입력칸에 줄 높이(lineHeight)를 적용하지 않아 첫 글자를 쓰기 전후로 칸 높이가 달랐다: 한 줄 높이는 늘 확보
        p.style.lineHeight ? { minHeight: p.style.lineHeight } : null,
      ]}
      placeholder={p.placeholder}
      placeholderTextColor={theme.muted}
      underlineColorAndroid="transparent"
    >
      {runs.map((x, i) => (
        <Text key={i} style={markStyle(x, theme)}>
          {x.text}
        </Text>
      ))}
    </TextInput>
  );
}
