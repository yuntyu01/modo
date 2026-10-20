import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useUi } from '../../state/AppContext';
import { InfoIcon, TrashIcon } from '../Icons';
import { flyToTrash } from '../trashFlight';
import { SWEEP_MS, useSweepDelay } from './sweep';

/** 카드 폭의 이만큼 넘게 왼쪽으로 밀면 놓았을 때 지운다 */
const THRESHOLD = 0.35;
/** 오른쪽(정보)은 지우기보다 가볍게 */
const INFO_THRESHOLD = 0.25;
/** 이보다 빠르게 튕기면(같은 방향으로 조금이라도 밀었을 때) 덜 밀어도 지운다 */
const FLING = 1200;
/** 가로로 이만큼, 그리고 세로보다 확실히(1.2배) 더 움직이면 밀기 시작 */
const START_X = 10;
/** 세로로 이만큼 움직였고 가로보다 크면 목록 스크롤로 보고 포기 */
const GIVE_UP_Y = 20;

/**
 * 할 일 카드를 옆으로 밀기: 왼쪽 = 지우기, 오른쪽 = 정보(onInfo가 있을 때. 없으면 오른쪽은 살짝만 따라오고 돌아온다).
 * 미는 동안 카드 뒤로 그쪽 바탕이 드러난다: 지우기는 빨간 바탕 + 휴지통, 정보는 회색 바탕 + i(사용자 요청 2026-10-18).
 * 놓을 때 왼쪽으로 카드 폭의 35%(정보는 25%)를 넘겼거나 빠르게 튕겼으면 바로 한다. 지운 카드는 휴지통이 든 ⋯ 버튼으로 날아 들어가고
 * (trashFlight, 실행 취소 가능) 정보는 카드가 제자리로 돌아오며 정보 시트가 열린다.
 * 바탕은 카드가 비켜난 자리와 카드 모서리 바깥에만 칠한다(카드 밑으로 깔리지 않게).
 * 할 만큼 밀면 아이콘이 커지고 짧게 진동한다. 덜 밀면 제자리로.
 * 가로로 충분히, 세로보다 확실히 더 움직였을 때만 시작하고 세로로 먼저 크게 움직이면 포기해서, 목록 스크롤·길게 눌러 끌기·글자 눌러 고치기와 겹치지 않는다.
 * 예전엔 세로로 10만 흔들려도 포기해서 손가락으로 그냥 밀면 잘 안 되고 꾹 누른 뒤 밀어야 됐다(사용자 요청 2026-10-19).
 * 휴대폰만: PC(웹)는 SwipeToDelete.web.tsx(감싸기만, 마우스로 끌면 글자 선택과 겹쳐 오른쪽 클릭 메뉴로 지운다).
 * 밀 수 없을 때(편집·끌기 중, 보기 전용)도 같은 모양을 유지하고 제스처만 끈다: 예전엔 다른 모양을 돌려줘 편집을 시작하거나
 * 끌기를 시작할 때마다 카드 안(글 편집기 포함)이 통째로 다시 만들어졌다.
 */
export function SwipeToDelete({
  enabled,
  onDelete,
  onInfo,
  label,
  radius,
  sweepKey,
  style,
  children,
}: {
  enabled: boolean;
  onDelete: () => void;
  /** 오른쪽으로 밀었을 때(정보 시트) */
  onInfo?: () => void;
  /** 날아가는 카드에 보일 글 */
  label: string;
  radius: number;
  /** 완료 묶음 '전체 지우기'로 쓸려 나갈 때 찾는 이름(할 일 id, sweep.ts) */
  sweepKey?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { theme } = useUi();
  // 날려 보낼 때 위치를 재는 카드(ref 대신 상태: 제스처 설정에서 읽어도 그리기 중 ref 접근이 아니다)
  const [card, setCard] = useState<View | null>(null);
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const armed = useSharedValue(false);
  const hidden = useSharedValue(false);
  // 덜 밀고 놓아 제자리로 돌아오는 중: 놓은 쪽(-1 왼쪽, 1 오른쪽), 미는 동안은 0
  const back = useSharedValue(0);
  // 돌아오다 가운데를 지나 좌우로 흔들리는 중(바탕을 숨긴다)
  const wobbling = useSharedValue(false);
  // '전체 지우기'로 쓸려 나가는 중(빨간 바탕 없이 카드만 밀려 나간다)
  const sweeping = useSharedValue(false);
  // 손가락을 댄 곳(밀기 시작을 방향으로 가른다)
  const downX = useSharedValue(0);
  const downY = useSharedValue(0);
  const sweepDelay = useSweepDelay(sweepKey);
  useEffect(() => {
    if (sweepDelay >= 0) {
      sweeping.set(true);
      x.set(withDelay(sweepDelay, withTiming(-(width.get() + 40), { duration: SWEEP_MS, easing: Easing.in(Easing.quad) })));
    } else if (sweeping.get()) {
      // 쓸어 내기가 끝났는데 아직 목록에 있으면(지우기 실패 등) 제자리로
      sweeping.set(false);
      x.set(withTiming(0));
    }
  }, [sweepDelay, sweeping, x, width]);

  const hasInfo = !!onInfo;
  const danger = theme.danger;
  const infoColor = theme.dark ? '#5A5D66' : '#9A9EA6';
  // 바탕 테두리 두께: 카드가 화면 밖으로 밀려 나가도(지우기, 날아갈 곳이 없을 때) 빈자리를 다 덮을 만큼
  const { width: screen } = useWindowDimensions();
  const ring = screen + 80;
  // 할 만큼 밀었을 때는 아이콘만 커진다(카드까지 줄이면 카드 위아래로 바탕이 실처럼 비쳤다)
  const cardStyle = useAnimatedStyle(() => ({ opacity: hidden.get() ? 0 : 1, transform: [{ translateX: x.get() }] }));
  // 카드 뒤 바탕: 카드 모양 구멍이 뚫린 두꺼운 테두리를 카드와 같이 움직이고 원래 카드 자리(둥근 모서리)로 자른다.
  // 그래서 카드가 비켜난 자리와 카드 모서리 바깥만 칠해진다. 예전엔 둥근 바탕을 카드 밑으로 모서리만큼 넣어
  // 다크 모드(카드가 반투명)에서 카드 끝이 빨갛게·회색으로 비치고, 밝은 테마에서는 둥근 두 끝이 만나는 곳이 파였다.
  // 가만히 있을 때는 숨긴다(구멍 가장자리가 카드 테두리처럼 비치지 않게).
  // 놓고 돌아올 때는 놓은 쪽 바탕만, 가운데를 지나 흔들리기 시작하면 아무 바탕도 보이지 않게
  // (튕겨 돌아오며 반대쪽으로 살짝 넘어갈 때 빨간색·회색이 번갈아 비쳤다, 사용자 요청 2026-10-19)
  const under = useAnimatedStyle(() => {
    const v = x.get();
    const b = back.get();
    const on = !hidden.get() && !wobbling.get() && !sweeping.get() && Math.abs(v) > 0.5 && (b === 0 || v * b > 0);
    return { opacity: on ? 1 : 0 };
  });
  useAnimatedReaction(
    () => x.get(),
    (v) => {
      if (back.get() !== 0 && v * back.get() < 0) wobbling.set(true);
    },
  );
  const ringStyle = useAnimatedStyle(() => ({
    borderColor: x.get() < 0 ? danger : infoColor,
    transform: [{ translateX: x.get() }],
  }));
  // 아이콘은 비켜난 자리 안에만(반투명한 카드 밑으로 비치지 않게)
  const deleteIcon = useAnimatedStyle(() => ({ width: Math.max(0, -x.get()) }));
  const infoIcon = useAnimatedStyle(() => ({ width: Math.max(0, x.get()) }));
  const iconPop = useAnimatedStyle(() => ({ transform: [{ scale: withSpring(armed.get() ? 1.18 : 0.9, { damping: 14, stiffness: 300 }) }] }));

  const pan = useMemo(() => {
    const tick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // 휴지통(⋯)으로 날려 보내고 지운다. 날아갈 곳이 없으면(그 화면에 ⋯가 없음) 옆으로 밀어 없앤다.
    const remove = async (dir: number) => {
      const flew = await flyToTrash(card, { text: label, color: theme.card, radius });
      if (flew) {
        hidden.set(true);
        onDelete();
      } else {
        x.set(
          withTiming(dir * (width.get() + 40), { duration: 170 }, (finished) => {
            if (finished) scheduleOnRN(onDelete);
          }),
        );
      }
      // 지운 카드는 목록에서 빠진다. 혹시 남아 있으면(지우기 실패 등) 제자리로
      setTimeout(() => {
        hidden.set(false);
        x.set(withTiming(0));
      }, 900);
    };
    const info = () => onInfo?.();
    return Gesture.Pan()
      .enabled(enabled)
      .manualActivation(true)
      .onTouchesDown((e) => {
        const p = e.changedTouches[0];
        downX.set(p.absoluteX);
        downY.set(p.absoluteY);
      })
      .onTouchesMove((e, state) => {
        const p = e.allTouches[0];
        const dx = Math.abs(p.absoluteX - downX.get());
        const dy = Math.abs(p.absoluteY - downY.get());
        if (dx >= START_X && dx >= dy * 1.2) state.activate();
        else if (dy >= GIVE_UP_Y && dy > dx) state.fail();
      })
      .onStart(() => {
        back.set(0);
        wobbling.set(false);
      })
      .onUpdate((e) => {
        // 정보가 없으면 오른쪽은 살짝만 따라온다
        const t = e.translationX > 0 && !hasInfo ? e.translationX * 0.2 : e.translationX;
        x.set(t);
        const w = width.get();
        const over = t < 0 ? -t > w * THRESHOLD : hasInfo && t > w * INFO_THRESHOLD;
        if (over !== armed.get()) {
          armed.set(over);
          if (over) scheduleOnRN(tick);
        }
      })
      .onEnd((e) => {
        const dir = Math.sign(e.translationX) || 1;
        const fling = Math.abs(e.velocityX) > FLING && Math.sign(e.velocityX) === dir && Math.abs(e.translationX) > 40;
        const go = armed.get() || fling;
        if (dir < 0 && go) scheduleOnRN(remove, dir);
        else {
          back.set(Math.sign(x.get()));
          x.set(withSpring(0, { damping: 20, stiffness: 260 }));
          if (dir > 0 && go && hasInfo) scheduleOnRN(info);
        }
        armed.set(false);
      });
  }, [enabled, card, onDelete, onInfo, hasInfo, label, radius, theme.card, x, width, armed, hidden, back, wobbling, downX, downY]);

  return (
    <View style={style} onLayout={(e) => width.set(e.nativeEvent.layout.width)}>
      {enabled ? (
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }, under]}>
        <Animated.View style={[{ position: 'absolute', top: -ring, bottom: -ring, left: -ring, right: -ring, borderWidth: ring, borderRadius: radius + ring }, ringStyle]} />
        <Animated.View style={[styles.icon, styles.end, deleteIcon]}>
          <Animated.View style={iconPop}>
            <TrashIcon color="#FFFFFF" size={22} strokeWidth={1.9} />
          </Animated.View>
        </Animated.View>
        {hasInfo ? (
          <Animated.View style={[styles.icon, styles.start, infoIcon]}>
            <Animated.View style={iconPop}>
              <InfoIcon color="#FFFFFF" size={22} strokeWidth={1.9} />
            </Animated.View>
          </Animated.View>
        ) : null}
      </Animated.View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View ref={setCard} collapsable={false} style={cardStyle}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', overflow: 'hidden' },
  // 휴지통은 오른쪽 끝에 붙어 왼쪽으로 늘어나고(왼쪽으로 밀면 드러난다), i는 왼쪽 끝에 붙어 오른쪽으로
  end: { right: 0, alignItems: 'flex-end', paddingRight: 24 },
  start: { left: 0, alignItems: 'flex-start', paddingLeft: 24 },
});
