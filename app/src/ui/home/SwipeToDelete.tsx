import * as Haptics from 'expo-haptics';
import { useMemo, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useApp } from '../../state/AppContext';
import { InfoIcon, TrashIcon } from '../Icons';
import { flyToTrash } from '../trashFlight';

/** 카드 폭의 이만큼 넘게 왼쪽으로 밀면 놓았을 때 지운다 */
const THRESHOLD = 0.35;
/** 오른쪽(정보)은 지우기보다 가볍게 */
const INFO_THRESHOLD = 0.25;
/** 이보다 빠르게 튕기면(같은 방향으로 조금이라도 밀었을 때) 덜 밀어도 지운다 */
const FLING = 1200;

/**
 * 할 일 카드를 옆으로 밀기: 왼쪽 = 지우기, 오른쪽 = 정보(onInfo가 있을 때. 없으면 오른쪽은 살짝만 따라오고 돌아온다).
 * 미는 동안 카드 뒤로 그쪽 바탕이 드러난다: 지우기는 빨간 바탕 + 휴지통, 정보는 회색 바탕 + i(사용자 요청 2026-10-18).
 * 놓을 때 왼쪽으로 카드 폭의 35%(정보는 25%)를 넘겼거나 빠르게 튕겼으면 바로 한다. 지운 카드는 휴지통이 든 ⋯ 버튼으로 날아 들어가고
 * (trashFlight, 실행 취소 가능) 정보는 카드가 제자리로 돌아오며 정보 시트가 열린다.
 * 할 만큼 밀면 아이콘이 커지고 짧게 진동한다. 덜 밀면 제자리로.
 * 가로로 충분히 움직였을 때만 시작하고 세로로 먼저 움직이면 포기해서, 목록 스크롤·길게 눌러 끌기·글자 눌러 고치기와 겹치지 않는다.
 * 휴대폰만: PC(웹)는 마우스로 끌면 글자 선택과 겹쳐 오른쪽 클릭 메뉴로 지운다.
 */
export function SwipeToDelete({
  enabled,
  onDelete,
  onInfo,
  label,
  radius,
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
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { theme } = useApp();
  // 날려 보낼 때 위치를 재는 카드(ref 대신 상태: 제스처 설정에서 읽어도 그리기 중 ref 접근이 아니다)
  const [card, setCard] = useState<View | null>(null);
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const armed = useSharedValue(false);
  const hidden = useSharedValue(false);

  const hasInfo = !!onInfo;
  const cardStyle = useAnimatedStyle(() => {
    return {
      opacity: hidden.get() ? 0 : 1,
      transform: [{ translateX: x.get() }, { scale: armed.get() ? 0.97 : 1 }],
    };
  });
  // 카드 뒤 바탕: 카드가 비켜난 자리에만(카드가 반투명이라 밑에 깔면 카드가 그 색으로 물들었다). 모서리 둥글기만큼만 카드 밑으로.
  // 할 만큼 밀면 아이콘이 커진다
  // 가만히 있을 때는 폭 0(모서리 밑으로도 비치지 않게)
  // (안쪽 여백 때문에 폭 0이어도 조금 남아 투명도도 0으로)
  const deleteBg = useAnimatedStyle(() => {
    const on = !hidden.get() && x.get() < 0;
    return { width: on ? radius - x.get() : 0, opacity: on ? 1 : 0 };
  });
  const infoBg = useAnimatedStyle(() => {
    const on = x.get() > 0;
    return { width: on ? radius + x.get() : 0, opacity: on ? 1 : 0 };
  });
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
      .activeOffsetX([-14, 14])
      .failOffsetY([-10, 10])
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
          x.set(withSpring(0, { damping: 20, stiffness: 260 }));
          if (dir > 0 && go && hasInfo) scheduleOnRN(info);
        }
        armed.set(false);
      });
  }, [card, onDelete, onInfo, hasInfo, label, radius, theme.card, x, width, armed, hidden]);

  if (!enabled || Platform.OS === 'web') return <View style={style}>{children}</View>;

  return (
    <View style={style} onLayout={(e) => width.set(e.nativeEvent.layout.width)}>
      <Animated.View pointerEvents="none" style={[styles.under, styles.end, { borderRadius: radius, backgroundColor: theme.danger }, deleteBg]}>
        <Animated.View style={iconPop}>
          <TrashIcon color="#FFFFFF" size={22} strokeWidth={1.9} />
        </Animated.View>
      </Animated.View>
      {hasInfo ? (
        <Animated.View pointerEvents="none" style={[styles.under, styles.start, { borderRadius: radius, backgroundColor: theme.dark ? '#5A5D66' : '#9A9EA6' }, infoBg]}>
          <Animated.View style={iconPop}>
            <InfoIcon color="#FFFFFF" size={22} strokeWidth={1.9} />
          </Animated.View>
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
  under: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', overflow: 'hidden' },
  // 지우기는 오른쪽 끝에 붙어 왼쪽으로 늘어나고(왼쪽으로 밀면 드러난다), 정보는 왼쪽 끝에 붙어 오른쪽으로
  end: { right: 0, alignItems: 'flex-end', paddingRight: 24 },
  start: { left: 0, alignItems: 'flex-start', paddingLeft: 24 },
});
