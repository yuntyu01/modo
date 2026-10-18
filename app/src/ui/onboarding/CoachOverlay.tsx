import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '../../state/AppContext';
import { coachComposerRef, coachStore, coachTodoRef, measure, useCoach, type Rect } from './coach';

/** 강조 테두리와 대상 사이 여백 */
const PAD = 6;
const RADIUS = 18;
/** 어둡게 덮는 테두리 두께(화면보다 크게). 안쪽 모서리 반지름 = 바깥 반지름 - 두께라 구멍이 강조 테두리처럼 둥글다 */
const COVER = 3000;

/**
 * 첫 실행 화면 다음 홈 안내: 주변을 어둡게 하고 강조 테두리가 ① 첫 실행 화면에서 적던 칸 → 홈의 그 할 일 → ② 입력창으로 옮겨 가며
 * '여기가 무엇인지' 말풍선으로 알려 준다. 아무 곳이나 누르면 다음, 마지막에 누르면 끝.
 */
export function CoachOverlay() {
  const coach = useCoach();
  const { theme, t } = useApp();
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<Rect | null>(null);
  const [screenH, setScreenH] = useState(0);
  const [x] = useState(() => new Animated.Value(0));
  const [y] = useState(() => new Animated.Value(0));
  const [w] = useState(() => new Animated.Value(0));
  const [h] = useState(() => new Animated.Value(0));
  const [bubble] = useState(() => new Animated.Value(0));
  const busy = useRef(false);

  const moveTo = (r: Rect, ms: number) => {
    setTarget(r);
    bubble.setValue(0);
    const go = (v: Animated.Value, to: number) => Animated.timing(v, { toValue: to, duration: ms, easing: Easing.inOut(Easing.cubic), useNativeDriver: false });
    Animated.parallel([go(x, r.x - PAD), go(y, r.y - PAD), go(w, r.w + PAD * 2), go(h, r.h + PAD * 2)]).start(() => {
      busy.current = false;
      Animated.timing(bubble, { toValue: 1, duration: 200, useNativeDriver: false }).start();
    });
  };

  // 새 안내가 시작되면 첫 단계로(그리는 중에 바로 맞춘다)
  const [seen, setSeen] = useState(coach);
  if (coach !== seen) {
    setSeen(coach);
    setStep(0);
    setTarget(coach?.from ?? null);
  }

  useEffect(() => {
    if (!coach) return;
    busy.current = true;
    const from = coach.from;
    if (from) {
      x.setValue(from.x - PAD);
      y.setValue(from.y - PAD);
      w.setValue(from.w + PAD * 2);
      h.setValue(from.h + PAD * 2);
    }
    measure(coachTodoRef).then((r) => {
      if (r) moveTo(r, from ? 560 : 0);
      else coachStore.set(null);
    });
    // 안내를 시작할 때만(같은 안내 안에서는 다시 재지 않는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach]);

  const next = async () => {
    if (busy.current) return;
    if (step === 0) {
      busy.current = true;
      const r = await measure(coachComposerRef);
      if (r) {
        setStep(1);
        return moveTo(r, 460);
      }
    }
    coachStore.set(null);
  };

  if (!coach) return null;
  const dim = 'rgba(0,0,0,0.62)';
  // 말풍선: 대상이 화면 아래쪽이면 위에, 위쪽이면 아래에
  const below = !!target && target.y + target.h / 2 < screenH / 2;
  const bubblePos = target ? (below ? { top: target.y + target.h + PAD + 14 } : { bottom: screenH - target.y + PAD + 14 }) : { top: 0 };
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => coachStore.set(null)}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={next}
        onLayout={(e) => setScreenH(e.nativeEvent.layout.height)}
        accessibilityRole="button"
        accessibilityLabel={`${step === 0 ? t('coachTodo') : t('coachComposer')} ${step === 0 ? t('coachNext') : t('coachDone')}`}
      >
        {/* 사각형 넷으로 덮으면 둥근 강조 테두리 바깥 모서리가 밝게 남았다 */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.cover,
            {
              borderColor: dim,
              left: Animated.subtract(x, COVER),
              top: Animated.subtract(y, COVER),
              width: Animated.add(w, COVER * 2),
              height: Animated.add(h, COVER * 2),
            },
          ]}
        />
        <Animated.View style={[styles.ring, { borderColor: theme.accent, left: x, top: y, width: w, height: h }]} />
        {target ? (
          <Animated.View style={[styles.bubble, bubblePos, { backgroundColor: theme.dark ? '#24262B' : '#FFFFFF', opacity: bubble }]}>
            <Text style={theme.kfont(15.5, { color: theme.text, lineHeight: 22 })}>{step === 0 ? t('coachTodo') : t('coachComposer')}</Text>
            <View style={styles.bubbleFoot}>
              <View style={styles.dots}>
                {[0, 1].map((i) => (
                  <View key={i} style={[styles.dot, { backgroundColor: i === step ? theme.accent : theme.dark ? '#4A4D55' : '#D3D7DE' }]} />
                ))}
              </View>
              <Text style={theme.kfont(14.5, { color: theme.accent, fontWeight: '600' })}>{step === 0 ? t('coachNext') : t('coachDone')}</Text>
            </View>
          </Animated.View>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', borderWidth: COVER, borderRadius: RADIUS + COVER },
  ring: { position: 'absolute', borderWidth: 2, borderRadius: RADIUS },
  bubble: { position: 'absolute', left: 20, right: 20, borderRadius: 16, paddingHorizontal: 18, paddingTop: 15, paddingBottom: 13 },
  bubbleFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
