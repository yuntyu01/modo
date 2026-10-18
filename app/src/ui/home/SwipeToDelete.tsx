import * as Haptics from 'expo-haptics';
import { useMemo, useState, type ReactNode } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useApp } from '../../state/AppContext';
import { flyToTrash } from '../trashFlight';

/** 카드 폭의 이만큼 넘게 밀면 놓았을 때 지운다 */
const THRESHOLD = 0.35;
/** 이보다 빠르게 튕기면(같은 방향으로 조금이라도 밀었을 때) 덜 밀어도 지운다 */
const FLING = 1200;

/**
 * 할 일 카드를 옆으로(왼쪽·오른쪽 어느 쪽이든) 밀어 지우기. 버튼을 누를 필요 없이, 놓을 때 카드 폭의 35%를 넘겼거나
 * 빠르게 튕겼으면 바로 지운다(휴지통으로, 실행 취소 가능). 지운 카드는 휴지통이 든 ⋯ 버튼으로 날아 들어간다(trashFlight).
 * 미는 동안은 카드만 손가락을 따라오고, 지울 만큼 밀면 살짝 작아지고 흐려지며 짧게 진동한다. 덜 밀면 제자리로.
 * 가로로 충분히 움직였을 때만 시작하고 세로로 먼저 움직이면 포기해서, 목록 스크롤·길게 눌러 끌기·글자 눌러 고치기와 겹치지 않는다.
 * 휴대폰만: PC(웹)는 마우스로 끌면 글자 선택과 겹쳐 오른쪽 클릭 메뉴로 지운다.
 */
export function SwipeToDelete({
  enabled,
  onDelete,
  label,
  radius,
  style,
  children,
}: {
  enabled: boolean;
  onDelete: () => void;
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

  const cardStyle = useAnimatedStyle(() => {
    const w = width.get() || 1;
    const k = Math.min(1, Math.abs(x.get()) / (w * THRESHOLD));
    return {
      opacity: hidden.get() ? 0 : 1 - 0.35 * k,
      transform: [{ translateX: x.get() }, { scale: armed.get() ? 0.96 : 1 }],
    };
  });

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
    return Gesture.Pan()
      .activeOffsetX([-14, 14])
      .failOffsetY([-10, 10])
      .onUpdate((e) => {
        x.set(e.translationX);
        const over = Math.abs(e.translationX) > width.get() * THRESHOLD;
        if (over !== armed.get()) {
          armed.set(over);
          if (over) scheduleOnRN(tick);
        }
      })
      .onEnd((e) => {
        const dir = Math.sign(e.translationX) || 1;
        const fling = Math.abs(e.velocityX) > FLING && Math.sign(e.velocityX) === dir && Math.abs(e.translationX) > 40;
        if (armed.get() || fling) scheduleOnRN(remove, dir);
        else x.set(withSpring(0, { damping: 20, stiffness: 260 }));
        armed.set(false);
      });
  }, [card, onDelete, label, radius, theme.card, x, width, armed, hidden]);

  if (!enabled || Platform.OS === 'web') return <View style={style}>{children}</View>;

  return (
    <View style={style} onLayout={(e) => width.set(e.nativeEvent.layout.width)}>
      <GestureDetector gesture={pan}>
        <Animated.View ref={setCard} collapsable={false} style={cardStyle}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
