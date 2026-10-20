import { useSyncExternalStore } from 'react';

/**
 * 완료 묶음 '완료 비우기'의 쓸어 내기: 지울 카드들이 위에서부터 빠르게 하나씩 왼쪽으로 밀려 나간다(사용자 요청 2026-10-19).
 * 홈이 지울 할 일 id를 화면 순서대로 넣으면 그 카드(SwipeToDelete sweepKey)가 자기 차례만큼 늦게 밀려 나가고,
 * 다 나간 뒤 홈이 실제로 지운다(휴지통, 실행 취소 가능). 목록에서 빠지면 홈이 비운다. 비웠는데 카드가 남아 있으면 제자리로.
 * 휴대폰만(PC는 옆으로 미는 카드가 없어 바로 지운다).
 */
export const SWEEP_MS = 220;
/** 카드 사이 간격(ms). 카드가 많으면 마지막 카드도 SPREAD 안에 출발하게 줄인다 */
const STEP = 45;
const SPREAD = 320;

let delays = new Map<string, number>();
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export const sweepStore = {
  /** 쓸어 내기를 시작하고, 마지막 카드까지 다 나가는 시간(ms)을 돌려준다 */
  start(ids: string[]) {
    const step = ids.length > 1 ? Math.min(STEP, SPREAD / (ids.length - 1)) : 0;
    delays = new Map(ids.map((id, i) => [id, Math.round(i * step)]));
    notify();
    return Math.round((ids.length - 1) * step) + SWEEP_MS;
  },
  clear() {
    if (!delays.size) return;
    delays = new Map();
    notify();
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

/** 이 카드가 쓸려 나갈 차례(늦출 ms). 쓸어 내는 중이 아니면 -1 */
export function useSweepDelay(key?: string) {
  const get = () => (key ? (delays.get(key) ?? -1) : -1);
  return useSyncExternalStore(sweepStore.subscribe, get, get);
}
