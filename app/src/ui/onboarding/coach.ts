import { createRef, useSyncExternalStore } from 'react';
import type { View } from 'react-native';

/** 화면 좌표(measureInWindow) */
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * 첫 실행 화면을 마친 뒤 홈에서 '여기가 어디인지' 짚어 주는 안내(CoachOverlay)의 상태.
 * todoId = 방금 적은 첫 할 일, from = 첫 실행 화면에서 그 할 일을 적던 칸(강조 테두리가 여기서 출발해 홈의 그 할 일로 옮겨 간다).
 */
export type Coach = { todoId: string; from: Rect | null } | null;

let current: Coach = null;
const subs = new Set<() => void>();

export const coachStore = {
  get: () => current,
  set(c: Coach) {
    current = c;
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

export function useCoach() {
  return useSyncExternalStore(coachStore.subscribe, coachStore.get, coachStore.get);
}

/** 안내가 짚을 곳: 그 할 일 카드(TodoCard가 자기 것일 때 붙인다)와 홈 입력창(홈 화면이 붙인다) */
export const coachTodoRef = createRef<View>();
export const coachComposerRef = createRef<View>();

/** 아직 그려지지 않았으면 잠깐씩 다시 잰다(새 할 일은 저장 직후 몇 프레임 뒤에 목록에 나타난다) */
export function measure(ref: { current: View | null }, tries = 12): Promise<Rect | null> {
  return new Promise((resolve) => {
    const go = (left: number) => {
      const v = ref.current;
      const retry = () => (left > 0 ? setTimeout(() => go(left - 1), 80) : resolve(null));
      if (!v) return retry();
      v.measureInWindow((x, y, w, h) => (w > 0 && h > 0 ? resolve({ x, y, w, h }) : retry()));
    };
    go(tries);
  });
}
