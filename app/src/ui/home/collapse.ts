import { useEffect } from 'react';
import { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const SETTLE = { duration: 180 };

/**
 * 홈 머리(로고 줄 · 폴더 줄)를 목록과 함께 접는다(사용자 요청 2026-10-26: 내릴 때 위가 고정이라 보기 힘들다. 휴대폰만).
 * 아래로 굴리면 굴린 만큼 위로 밀려 숨고, 위로 굴리면 그만큼 다시 내려온다(맨 위로 가지 않아도 폴더를 바꿀 수 있게).
 * 손을 뗐을 때 반쯤 걸친 머리는 다 보이거나 다 숨는다. 맨 위 근처에서는 목록 첫 줄과 함께 움직인다.
 * - range: 숨는 높이(머리 높이 − 상태 표시줄). enabled=false(찾는 중 · 키보드로 머리를 뺀 때)면 늘 보인다.
 * - resetKey: 바뀌면(폴더를 바꿔 목록이 맨 위에서 다시 시작) 머리도 다시 보인다.
 * - style: 머리에, backStyle: 머리 안 바탕(화면에 고정된 그라데이션이 머리와 함께 밀리지 않게 거꾸로 움직인다).
 */
export function useCollapsingHeader(range: number, enabled: boolean, resetKey: string) {
  const hidden = useSharedValue(0);
  const lastY = useSharedValue(0);
  const max = useSharedValue(range);
  const on = useSharedValue(enabled);
  useEffect(() => {
    max.set(range);
    if (hidden.get() > range) hidden.set(range);
  }, [range, max, hidden]);
  useEffect(() => {
    on.set(enabled);
    if (!enabled) hidden.set(withTiming(0, SETTLE));
  }, [enabled, on, hidden]);
  useEffect(() => {
    lastY.set(0);
    hidden.set(withTiming(0, SETTLE));
  }, [resetKey, lastY, hidden]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      const y = e.contentOffset.y;
      const dy = y - lastY.get();
      lastY.set(y);
      if (!on.get()) return;
      // 끝에서 튕기는 동안(iOS)은 따라가지 않는다: 바닥에서 머리가 들썩이지 않게
      if (y > Math.max(0, e.contentSize.height - e.layoutMeasurement.height)) return;
      hidden.set(Math.min(Math.max(hidden.get() + dy, 0), max.get(), Math.max(y, 0)));
    },
    // 던지지 않고 놓으면 바로, 던졌으면 멈춘 뒤 정리한다
    onEndDrag: (e) => {
      if (Math.abs(e.velocity?.y ?? 0) < 0.05) settle(e.contentOffset.y);
    },
    onMomentumEnd: (e) => settle(e.contentOffset.y),
  });

  function settle(y: number) {
    'worklet';
    const h = hidden.get();
    const m = max.get();
    if (!on.get() || h <= 0 || h >= m) return;
    hidden.set(withTiming(h > m / 2 && y >= m ? m : 0, SETTLE));
  }

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -hidden.get() }] }));
  const backStyle = useAnimatedStyle(() => ({ transform: [{ translateY: hidden.get() }] }));
  return { onScroll, style, backStyle };
}
