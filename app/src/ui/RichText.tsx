import type { ReactNode } from 'react';
import { Text, type GestureResponderEvent, type TextStyle } from 'react-native';

import { linkifyRuns, parseRich, type Run } from '../core/rich';
import { useUi } from '../state/AppContext';
import { deepAccent } from './color';
import type { Theme } from './theme';

/** 링크 글자색: 다크는 테마색, 라이트는 흰 바탕에서도 또렷한 진한 테마색 */
export function linkColor(theme: Theme) {
  return theme.dark ? theme.accent : deepAccent(theme.accent);
}

/**
 * 꾸민 조각의 글자 모양. struck = 바탕 글이 이미 줄이 그어져 있다(완료한 할 일): 안쪽 조각의 줄 모양이 바탕을 덮어써서 함께 넣는다.
 * 꾸밈이 없으면 null.
 */
export function markStyle(r: Run, theme: Theme, struck = false): TextStyle | null {
  const under = !!r.u || !!r.href;
  const strike = !!r.s || (struck && (under || !!r.b));
  if (!r.b && !under && !strike) return null;
  const st: TextStyle = {};
  if (r.b) st.fontWeight = '700';
  if (under || strike) st.textDecorationLine = under && strike ? 'underline line-through' : under ? 'underline' : 'line-through';
  if (r.href) st.color = linkColor(theme);
  return st;
}

/**
 * 저장된 글을 Text 안에 넣을 조각들로. 꾸밈·주소가 없으면 글 그대로(조각을 만들지 않는다).
 * onLink: 링크 조각을 눌렀을 때(링크 말풍선). 주소처럼 생긴 글(https://…)도 링크로 보인다.
 */
export function richNodes(
  src: string,
  theme: Theme,
  opts?: { onLink?: (href: string, e: GestureResponderEvent) => void; struck?: boolean },
): ReactNode {
  const runs = linkifyRuns(parseRich(src));
  if (runs.every((r) => !r.b && !r.u && !r.s && !r.href)) return runs.map((r) => r.text).join('');
  const onLink = opts?.onLink;
  return runs.map((r, i) => {
    const st = markStyle(r, theme, opts?.struck);
    if (!st) return r.text;
    return (
      <Text
        key={i}
        style={st}
        onPress={
          r.href && onLink
            ? (e) => {
                // PC: 바깥 글(누르면 고치기)까지 눌림이 올라가지 않게
                (e as unknown as { stopPropagation?: () => void }).stopPropagation?.();
                onLink(r.href!, e);
              }
            : undefined
        }
        suppressHighlighting
        accessibilityRole={r.href ? 'link' : undefined}
      >
        {r.text}
      </Text>
    );
  });
}

/** Text 안에 넣는 꾸민 글 조각(richNodes를 컴포넌트로: 누르기 처리기를 그리는 중에 부르지 않게) */
export function RichSpans(p: { src: string; onLink?: (href: string, e: GestureResponderEvent) => void; struck?: boolean }) {
  const { theme } = useUi();
  return <>{richNodes(p.src, theme, { onLink: p.onLink, struck: p.struck })}</>;
}
