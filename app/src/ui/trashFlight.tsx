import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useUi } from '../state/AppContext';
import { TrashIcon } from './Icons';

/**
 * 지운 할 일이 휴지통(⋯ 메뉴 안)으로 날아 들어가는 효과.
 * - 과녁: 휴지통으로 가는 ⋯ 버튼. 머리(홈·더보기 오른쪽 위 ⋯)가 있으면 그쪽, 없으면 하단바의 ⋯ 탭. 버튼이 useTrashTarget으로 등록한다.
 * - 날아가는 카드는 목록에 잘리지 않게 화면 맨 위 층(TrashFlightHost)에 따로 그린다.
 */
type Rect = { x: number; y: number; width: number; height: number };
type Target = { priority: number; view: View | null; bump: () => void };
type Flight = { id: number; from: Rect; to: Rect; text: string; color: string; radius: number; target: Target };

const targets = new Set<Target>();
let launch: ((f: Omit<Flight, 'id'>) => void) | null = null;

function measure(view: View | null): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!view) return resolve(null);
    view.measureInWindow((x, y, width, height) => resolve(width || height ? { x, y, width, height } : null));
  });
}

/** 지금 화면에서 날아갈 곳(우선순위가 높은 ⋯ 버튼부터, 화면에 보이는 것만) */
async function currentTarget() {
  for (const t of [...targets].sort((a, b) => b.priority - a.priority)) {
    const r = await measure(t.view);
    if (r) return { target: t, rect: r };
  }
  return null;
}

/**
 * 카드(from)를 휴지통 쪽으로 날려 보낸다. 날아갈 곳이 없거나 겹 층이 없으면 false(호출한 쪽이 옆으로 밀어 없앤다).
 */
export async function flyToTrash(card: View | null, ghost: { text: string; color: string; radius: number }) {
  if (!launch) return false;
  const [from, to] = await Promise.all([measure(card), currentTarget()]);
  if (!from || !to) return false;
  launch({ from, to: to.rect, target: to.target, ...ghost });
  return true;
}

/**
 * 휴지통으로 가는 ⋯ 아이콘. 날아온 카드가 닿으면 ⋯가 잠깐 휴지통으로 바뀌어 톡 튀었다가 다시 ⋯로 돌아온다.
 * priority: 머리의 ⋯(2)가 하단바 ⋯ 탭(1)보다 먼저.
 */
export function TrashTargetIcon({ priority, size, children }: { priority: number; size: number; children: ReactNode }) {
  const { theme } = useUi();
  const ref = useRef<View>(null);
  const morph = useSharedValue(0); // 0 = ⋯, 1 = 휴지통
  const pop = useSharedValue(1);
  useEffect(() => {
    const t: Target = {
      priority,
      get view() {
        return ref.current;
      },
      bump: () => {
        morph.set(withSequence(withTiming(1, { duration: 120 }), withDelay(520, withTiming(0, { duration: 220 }))));
        pop.set(withSequence(withTiming(1.3, { duration: 120 }), withSpring(1, { damping: 9, stiffness: 260 })));
      },
    };
    targets.add(t);
    return () => {
      targets.delete(t);
    };
  }, [priority, morph, pop]);
  const box = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));
  const dots = useAnimatedStyle(() => ({ opacity: 1 - morph.get(), transform: [{ scale: 1 - 0.4 * morph.get() }] }));
  const trash = useAnimatedStyle(() => ({ opacity: morph.get(), transform: [{ scale: 0.6 + 0.4 * morph.get() }] }));
  return (
    <Animated.View ref={ref} collapsable={false} style={box}>
      <Animated.View style={dots}>{children}</Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, trash]}>
        <TrashIcon color={theme.accent} size={size * 0.85} strokeWidth={2} />
      </Animated.View>
    </Animated.View>
  );
}

/** 화면 맨 위에 한 번만 둔다(app/_layout). */
export function TrashFlightHost() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const origin = useRef<View>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    let n = 0;
    launch = (f) => setFlights((cur) => [...cur, { ...f, id: ++n }]);
    return () => {
      launch = null;
    };
  }, []);
  // 늘 같은 함수: 다른 카드를 또 지우거나 층이 다시 재일 때 날아가던 카드의 애니메이션이 처음부터 다시 시작되지 않게
  const finish = useCallback((id: number) => setFlights((cur) => cur.filter((x) => x.id !== id)), []);
  return (
    <View
      ref={origin}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      // 이 층의 화면 위치(측정값은 창 기준이라 이 층 기준으로 옮긴다)
      onLayout={() => origin.current?.measureInWindow((x, y) => setOffset({ x, y }))}
    >
      {flights.map((f) => (
        <Ghost key={f.id} flight={f} offset={offset} onDone={finish} />
      ))}
    </View>
  );
}

const DURATION = 520;

function Ghost({ flight, offset, onDone }: { flight: Flight; offset: { x: number; y: number }; onDone: (id: number) => void }) {
  const { theme } = useUi();
  const p = useSharedValue(0);
  // UI 스레드 함수(useAnimatedStyle)에는 숫자만 넘긴다: flight에는 과녁(⋯ 버튼 화면 요소)이 들어 있어
  // 통째로 쓰면 복사하지 못해 앱이 멈췄다('Cannot copy value of type ReactNativeElement', 2026-10-18)
  const { from, to, radius } = flight;
  // 카드 가운데 → ⋯ 가운데. 위로 살짝 휘어 날아간다(포물선).
  const sx = from.x + from.width / 2 - offset.x;
  const sy = from.y + from.height / 2 - offset.y;
  const ex = to.x + to.width / 2 - offset.x;
  const ey = to.y + to.height / 2 - offset.y;
  useEffect(() => {
    const fire = () => {
      flight.target.bump();
      onDone(flight.id);
    };
    p.set(
      withTiming(1, { duration: DURATION, easing: Easing.inOut(Easing.cubic) }, (finished) => {
        if (finished) scheduleOnRN(fire);
      }),
    );
  }, [p, flight, onDone]);
  // 처음엔 납작한 알약으로 빠르게 줄고(세로가 먼저), 날아가며 점이 되어 ⋯ 속으로 빨려 들어간다.
  const style = useAnimatedStyle(() => {
    const t = p.get();
    const arc = -Math.min(120, Math.abs(ey - sy) * 0.25 + 40) * Math.sin(Math.PI * t);
    const squash = Math.min(1, t / 0.35); // 0~0.35: 알약으로
    return {
      opacity: t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25,
      borderRadius: radius + (from.height / 2 - radius) * squash,
      transform: [
        { translateX: sx + (ex - sx) * t - from.width / 2 },
        { translateY: sy + (ey - sy) * t + arc - from.height / 2 },
        { scaleX: 1 - 0.55 * squash - 0.4 * t },
        { scaleY: 1 - 0.6 * squash - 0.32 * t },
      ],
    };
  });
  const label = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, p.get() / 0.3) }));
  return (
    <Animated.View
      style={[styles.ghost, { width: from.width, height: from.height, backgroundColor: flight.color }, style]}
    >
      <Animated.Text numberOfLines={1} style={[theme.kfont(17 * theme.zoom, { color: theme.text }), label]}>
        {flight.text}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ghost: {
    position: 'absolute',
    left: 0,
    top: 0,
    justifyContent: 'center',
    paddingHorizontal: 22,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
});
