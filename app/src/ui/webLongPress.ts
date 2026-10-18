import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

const HOLD_MS = 500;
/** 누른 채 이만큼 움직이면(글자 고르기·창 끌기) 길게 누르기가 아니다 */
const MOVE_PX = 6;

/** 길게 누른 뒤 손을 떼며 따라오는 클릭 하나를 삼킨다(제목 편집·완료로 넘어가지 않게) */
function swallowNextClick() {
  const eat = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', eat, true);
  // 클릭은 손을 뗀 바로 뒤에 온다. 다른 곳에서 떼어 클릭이 생기지 않아도 바로 치운다
  const up = () => {
    window.removeEventListener('mouseup', up, true);
    setTimeout(() => window.removeEventListener('click', eat, true), 0);
  };
  window.addEventListener('mouseup', up, true);
}

type MouseLike = { button: number; clientX: number; clientY: number; target: unknown; preventDefault: () => void };

/**
 * PC(웹) 길게 누르기: 오른쪽 클릭, 또는 왼쪽 버튼을 0.5초 누르고 있으면 onLongPress(react-native-web에는 onLongPress가 없다).
 * 눌린 채 길게 누르기가 되면 그 뒤 놓을 때의 클릭은 삼킨다. skip(target)이 참이면(동그라미·버튼·입력칸) 받지 않는다.
 * 휴대폰에서는 null(각 Pressable·Text의 onLongPress를 쓴다).
 */
export function useWebLongPress(
  onLongPress: (() => void) | undefined,
  opts?: { onDown?: () => void; onLeave?: () => void; skip?: (target: Element) => boolean },
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const at = useRef({ x: 0, y: 0 });
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  if (Platform.OS !== 'web' || !onLongPress) return null;
  const skipped = (e: MouseLike) => !!opts?.skip && e.target instanceof Element && opts.skip(e.target);
  return {
    onContextMenu: (e: MouseLike) => {
      if (skipped(e)) return;
      e.preventDefault();
      clear();
      opts?.onDown?.();
      onLongPress();
    },
    onMouseDown: (e: MouseLike) => {
      opts?.onDown?.();
      clear();
      if (e.button !== 0 || skipped(e)) return;
      at.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        swallowNextClick();
        onLongPress();
      }, HOLD_MS);
    },
    onMouseMove: (e: MouseLike) => {
      if (timer.current && Math.hypot(e.clientX - at.current.x, e.clientY - at.current.y) > MOVE_PX) clear();
    },
    onMouseUp: clear,
    onMouseLeave: () => {
      clear();
      opts?.onLeave?.();
    },
  };
}
