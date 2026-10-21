import type { TextStyle } from 'react-native';

/** 꾸민 글 입력칸(휴대폰 RichEditor.tsx · PC RichEditor.web.tsx). 글은 저장 형식(core/rich.ts), 위치는 plain 기준 */
export type RichEditorProps = {
  initial: string;
  /** 처음 커서 위치 */
  caret: number;
  style: TextStyle;
  placeholder?: string;
  /** 글이 바뀔 때마다(저장은 EditableText가 묶어서) */
  onChange: (markup: string) => void;
  /** 메모 문단: 줄바꿈 → 문단 나누기. 없으면(할 일) 엔터로 편집 끝 */
  onSplit?: (before: string, after: string[], caretInLast: number) => void;
  /** 문단 맨 앞에서 지우기 → 앞 문단과 합치기 */
  onMergeBack?: (markup: string) => void;
  /** 편집 끝(입력칸을 벗어남) */
  onEnd: () => void;
};
