import type { ReactNode } from 'react';

export type TextTip = {
  /** 말줄임이 걸리는 글(Text)에 붙인다 */
  ref: (el: unknown) => void;
  /** 마우스를 올렸을 때(0.5초 뒤 잘린 글이면 말풍선) */
  enter: () => void;
  hide: () => void;
  /** 지금 줄 수 제한으로 잘려 있는지(PC만 알 수 있다. 휴대폰은 EditableText가 글줄로 판단) */
  clipped: () => boolean;
  /** 말풍선(어디에 둬도 화면 맨 위층에 뜬다) */
  node: ReactNode;
};

const none: TextTip = { ref: () => {}, enter: () => {}, hide: () => {}, clipped: () => false, node: null };

/** 휴대폰: 마우스 올리기가 없어 말풍선도 없다(누르면 펼쳐진다). PC는 textTip.web.tsx */
export function useTextTip(_text: string, _enabled: boolean): TextTip {
  return none;
}
