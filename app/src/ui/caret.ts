import { Platform, type GestureResponderEvent, type TextLayoutLine } from 'react-native';

/**
 * 읽기 상태의 글자를 눌렀을 때 그 위치의 글자 오프셋을 구한다(그 자리에서 편집 시작용).
 * 네이티브: onTextLayout의 줄 정보로 줄을 찾고 줄 안에서는 너비 비율로 추정(한글은 고정폭에 가까워 정확함).
 * 웹(데스크톱): 브라우저의 caretRangeFromPoint로 정확히 구한다.
 */
export function caretFromTap(e: GestureResponderEvent, lines: TextLayoutLine[] | null, text: string): number {
  if (Platform.OS === 'web') {
    const ne = e.nativeEvent as unknown as { clientX: number; clientY: number; pageX: number; pageY: number };
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offset: number } | null;
    };
    const x = ne.clientX ?? ne.pageX;
    const y = ne.clientY ?? ne.pageY;
    const r = doc.caretRangeFromPoint?.(x, y);
    if (r) return Math.min(text.length, r.startOffset);
    const p = doc.caretPositionFromPoint?.(x, y);
    return p ? Math.min(text.length, p.offset) : text.length;
  }
  if (!lines?.length) return text.length;
  const { locationX: x, locationY: y } = e.nativeEvent;
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLast = i === lines.length - 1;
    if (y <= line.y + line.height || isLast) {
      const visible = line.text.replace(/\n$/, '');
      const rel = (x - line.x) / Math.max(1, line.width);
      const inLine = Math.round(Math.max(0, Math.min(1, rel)) * visible.length);
      return Math.min(text.length, offset + inLine);
    }
    offset += line.text.length;
  }
  return text.length;
}
