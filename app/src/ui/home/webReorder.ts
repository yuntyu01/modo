import { useEffect, useRef, useState } from 'react';
import { Platform, type LayoutChangeEvent, type ViewStyle } from 'react-native';

type Drag = { id: string; from: number; to: number; dy: number; h: number };

/**
 * PC(웹) 미니창: 할 일을 꾹(0.5초) 눌러 위아래로 끌어 순서 바꾸기.
 * - 끄는 동안 들린 카드는 커서를 따라오고, 다른 카드는 비켜나며 부드럽게 움직인다.
 * - 놓으면 onDrop(새 순서). 저장이 반영될 때까지는 새 순서로 보여 줘서 제자리로 튀었다 돌아오지 않는다.
 * - 움직이지 않고 놓았거나(그냥 꾹 누르기) 오른쪽 클릭이면 onInfo(항목 정보).
 * 카드의 길게 누르기(EditableText의 0.5초 누르기·오른쪽 클릭)가 start를 부른다.
 */
export function useWebReorder(ids: string[], onDrop: (id: string, order: string[]) => void, onInfo: (id: string) => void) {
  const rows = useRef(new Map<string, { y: number; h: number }>());
  const pointer = useRef({ y: 0, down: false });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  // 저장된 순서가 들어오면(목록이 바뀌면) 임시 순서를 버린다
  const key = ids.join(',');
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setOrder(null);
  }
  const ordered = order && order.length === ids.length ? order : ids;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const down = (e: MouseEvent) => (pointer.current = { y: e.clientY, down: e.button === 0 });
    const up = () => (pointer.current.down = false);
    const move = (e: MouseEvent) => (pointer.current.y = e.clientY);
    window.addEventListener('mousedown', down, true);
    window.addEventListener('mouseup', up, true);
    window.addEventListener('mousemove', move, true);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('mouseup', up, true);
      window.removeEventListener('mousemove', move, true);
    };
  }, []);

  const start = (id: string) => {
    const from = ordered.indexOf(id);
    const me = rows.current.get(id);
    // 오른쪽 클릭(버튼이 이미 떨어짐)이거나 끌 수 없는 항목(완료 묶음)이면 정보
    if (Platform.OS !== 'web' || !pointer.current.down || from < 0 || !me) return onInfo(id);
    const startY = pointer.current.y;
    let moved = false;
    let to = from;
    document.body.style.userSelect = 'none';
    window.getSelection()?.removeAllRanges();
    setDrag({ id, from, to, dy: 0, h: me.h });
    const move = (e: MouseEvent) => {
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      const center = me.y + me.h / 2 + dy;
      to = ordered.filter((x) => {
        const r = x !== id && rows.current.get(x);
        return r && r.y + r.h / 2 < center;
      }).length;
      setDrag({ id, from, to, dy, h: me.h });
    };
    const up = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      document.body.style.userSelect = '';
      setDrag(null);
      if (!moved) return onInfo(id);
      if (to === from) return;
      const next = ordered.filter((x) => x !== id);
      next.splice(to, 0, id);
      setOrder(next);
      onDrop(id, next);
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  };

  const onRowLayout = (id: string) => (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    rows.current.set(id, { y, h: height });
  };

  /** 끄는 동안의 위치. 들린 카드는 커서를 따라, 사이에 있던 카드는 들린 카드 높이만큼 비켜난다(끄는 동안만 부드럽게). */
  const rowStyle = (id: string): ViewStyle | null => {
    if (!drag) return null;
    if (id === drag.id) {
      return {
        transform: [{ translateY: drag.dy }, { scale: 1.02 }],
        zIndex: 10,
        opacity: 0.96,
        shadowColor: '#000000',
        shadowOpacity: 0.18,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        ...({ cursor: 'grabbing' } as object),
      };
    }
    const i = ordered.indexOf(id);
    let shift = 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -drag.h;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) shift = drag.h;
    return {
      transform: [{ translateY: shift }],
      ...({ transitionProperty: 'transform', transitionDuration: '160ms', transitionTimingFunction: 'ease-out' } as object),
    };
  };

  return { ordered, start, onRowLayout, rowStyle, dragging: !!drag };
}
