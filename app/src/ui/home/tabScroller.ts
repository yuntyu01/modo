import { useEffect, useRef, type RefObject } from 'react';
import { Platform, type LayoutChangeEvent, type ScrollView } from 'react-native';

/**
 * 가로로 넘치는 폴더 줄(PC 미니창).
 * - 마우스 휠(위아래로 굴려도)과 폴더를 잡고 끌어서 옆으로 넘긴다. 끌고 놓았을 때는 폴더가 눌리지 않는다.
 * - 고른 폴더를 가운데로 부드럽게 옮긴다(맨 앞·맨 끝 폴더는 그 끝까지만).
 * ref: 폴더 줄 ScrollView(부르는 쪽이 만들어 ref로 붙인다). remountKey: 폴더 줄이 다시 그려질 때(줄인 머리 ↔ 펼친 머리) 휠·끌기를 다시 붙이려고.
 */
export function useTabScroller(ref: RefObject<ScrollView | null>, selected: string, remountKey: unknown) {
  const tabs = useRef(new Map<string, { x: number; w: number }>());
  const viewW = useRef(0);
  const dragged = useRef(false);
  // 휴대폰(네이티브)은 DOM이 없어 스크롤 위치·내용 폭을 이벤트로 기억한다
  const scrollX = useRef(0);
  const contentW = useRef(0);

  // 고른 폴더를 가운데로. 맨 앞·맨 끝 쪽이라 가운데로 못 오는 폴더는 굳이 옮기지 않고(옆 폴더가 덜 움직이게),
  // 가려져 있을 때만 보이는 데까지만 민다.
  const center = (key: string, animated: boolean) => {
    const t = tabs.current.get(key);
    if (!t || !viewW.current) return;
    const el = (ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.();
    const left = el?.scrollLeft ?? scrollX.current;
    const max = el ? el.scrollWidth - el.clientWidth : contentW.current ? Math.max(0, contentW.current - viewW.current) : Infinity;
    const want = t.x + t.w / 2 - viewW.current / 2;
    let x: number | null = want >= 0 && want <= max ? want : null;
    if (x === null) {
      if (t.x < left) x = Math.max(0, t.x - 8);
      else if (t.x + t.w > left + viewW.current) x = Math.min(max, t.x + t.w - viewW.current + 8);
    }
    if (x !== null && Math.abs(x - left) > 1) ref.current?.scrollTo({ x, animated });
  };
  useEffect(() => {
    center(selected, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = (ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.();
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      e.preventDefault();
    };
    let start: { x: number; left: number } | null = null;
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, left: el.scrollLeft };
      dragged.current = false;
      // 끄는 동안 폴더 이름이 글자 선택으로 파랗게 남지 않게(이미 남은 선택도 지운다)
      window.getSelection()?.removeAllRanges();
      document.body.style.userSelect = 'none';
    };
    const move = (e: MouseEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      if (Math.abs(dx) > 4) dragged.current = true;
      if (dragged.current) el.scrollLeft = start.left - dx;
    };
    // 끌고 놓은 뒤 따라오는 클릭(폴더 누르기)은 무시하고 다음 차례에 푼다
    const up = () => {
      if (start) document.body.style.userSelect = '';
      start = null;
      setTimeout(() => (dragged.current = false), 0);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('mousedown', down);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [ref, remountKey]);

  return {
    onLayout: (e: LayoutChangeEvent) => {
      viewW.current = e.nativeEvent.layout.width;
      center(selected, false);
    },
    /** 각 폴더 위치(처음 그려질 때 고른 폴더면 바로 가운데로) */
    tabLayout: (key: string) => (e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      tabs.current.set(key, { x, w: width });
      if (key === selected) center(key, false);
    },
    onScroll: (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      scrollX.current = e.nativeEvent.contentOffset.x;
    },
    onContentSizeChange: (w: number) => {
      contentW.current = w;
    },
    /** 끌어서 넘긴 직후의 클릭은 무시 */
    guard: (fn: () => void) => () => {
      if (!dragged.current) fn();
    },
  };
}
