import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, type LayoutChangeEvent } from 'react-native';

/**
 * 고른 칸을 따라 미끄러지는 알약(하단바·나눔 선택). 칸마다 onItemLayout을 달고, 알약은 pill 모양으로 칸 뒤에 그린다.
 * 옮길 때는 물 흐르듯: 가로로 잠깐 늘어났다가(1.22배) 새 칸에서 탄성 있게 멈춘다. 처음에는 움직이지 않고 그 자리에.
 * 칸 너비가 모두 같다고 본다(하단바 65, 나눔 선택은 같은 비율).
 */
export function useSlidingPill(index: number) {
  const [layouts, setLayouts] = useState<{ x: number; w: number }[]>([]);
  const [x] = useState(() => new Animated.Value(0));
  const [stretch] = useState(() => new Animated.Value(1));
  const placed = useRef(false);
  const target = index >= 0 ? layouts[index] : undefined;
  const tx = target?.x;
  useEffect(() => {
    if (tx == null) return;
    if (!placed.current) {
      placed.current = true;
      x.setValue(tx);
      return;
    }
    Animated.parallel([
      Animated.spring(x, { toValue: tx, damping: 17, stiffness: 210, mass: 0.9, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(stretch, { toValue: 1.22, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(stretch, { toValue: 1, damping: 11, stiffness: 240, useNativeDriver: true }),
      ]),
    ]).start();
  }, [tx, x, stretch]);
  const onItemLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x: lx, width } = e.nativeEvent.layout;
    setLayouts((prev) => {
      if (prev[i]?.x === lx && prev[i]?.w === width) return prev;
      const next = [...prev];
      next[i] = { x: lx, w: width };
      return next;
    });
  };
  const pill = target ? { position: 'absolute' as const, left: 0, width: target.w, transform: [{ translateX: x }, { scaleX: stretch }] } : null;
  return { onItemLayout, pill };
}

/** 새로 고른 아이콘이 살짝 작아졌다 튀어 오르며 커진다(active가 켜질 때만) */
export function usePop(active: boolean) {
  const [scale] = useState(() => new Animated.Value(1));
  const was = useRef(active);
  useEffect(() => {
    if (active && !was.current) {
      scale.setValue(0.82);
      Animated.spring(scale, { toValue: 1, damping: 9, stiffness: 260, useNativeDriver: true }).start();
    }
    was.current = active;
  }, [active, scale]);
  return { transform: [{ scale }] };
}
