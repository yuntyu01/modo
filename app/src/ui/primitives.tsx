import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { inputColors } from './theme';
import { useIsFocused } from 'expo-router';

import { useToast, useUi } from '../state/AppContext';
import { ChevronIcon } from './Icons';
import { useSlidingPill } from './motion';

/** 아래에서 올라오는 시트. 상태바·내비게이션 영역을 피한다. soft: 바탕을 화면 바탕색으로(안에 흰 카드를 놓는 시트, 친구 추가 시안) */
export function Sheet({ visible, onClose, children, soft }: { visible: boolean; onClose: () => void; children: ReactNode; soft?: boolean }) {
  const { theme, t } = useUi();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('cancel')}>
          <Pressable
            style={[
              styles.sheet,
              { backgroundColor: theme.dark ? '#18191C' : soft ? theme.bg : '#FFFFFF', marginBottom: insets.bottom + 10, maxHeight: '86%' },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
              {children}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SheetTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const { theme } = useUi();
  return (
    <View style={{ paddingHorizontal: 22, paddingTop: 18, paddingBottom: 8 }}>
      <Text style={theme.font(13, { color: theme.muted })}>{title}</Text>
      {subtitle ? (
        <Text style={theme.font(16, { color: theme.text, marginTop: 6 })} numberOfLines={3}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function SheetButton({
  label,
  onPress,
  danger,
  icon,
  disabled,
  selected,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  icon?: ReactNode;
  disabled?: boolean;
  /** 고르는 목록: true면 진하고 굵게, false면 옅게(체크 표시 대신) */
  selected?: boolean;
}) {
  const { theme } = useUi();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={selected === undefined ? 'button' : 'radio'}
      accessibilityState={selected === undefined ? undefined : { selected }}
      style={({ pressed }) => [styles.sheetBtn, pressed && { backgroundColor: theme.raised }, disabled && { opacity: 0.4 }]}
    >
      {icon ? <View style={{ marginRight: 14 }}>{icon}</View> : null}
      <Text
        style={theme.font(16, {
          color: danger ? theme.danger : selected === false ? theme.muted : theme.text,
          ...(selected ? { fontWeight: '700' as const } : null),
        })}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  const { theme } = useUi();
  return (
    <View style={styles.infoRow}>
      <Text style={theme.font(14, { color: theme.muted, width: 92 })}>{label}</Text>
      <Text style={theme.font(14, { color: theme.text, flex: 1 })}>{value}</Text>
    </View>
  );
}

/** 이름 입력 등 한 줄짜리 대화상자 */
export function PromptDialog({
  visible,
  title,
  initial = '',
  placeholder,
  confirmLabel,
  maxLength = 40,
  secure,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength?: number;
  secure?: boolean;
  onConfirm: (v: string) => void;
  onClose: () => void;
}) {
  const { theme, t } = useUi();
  const [value, setValue] = useState(initial);
  // 열릴 때마다 처음 값으로(그리는 중에 바로 맞춘다)
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setValue(initial);
  }
  const ok = value.trim().length > 0;
  const confirm = () => {
    if (!ok) return;
    onClose();
    onConfirm(value.trim());
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.center}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.dialog, { backgroundColor: theme.dark ? '#18191C' : '#FFFFFF' }]}>
          <Text style={theme.font(17, { color: theme.text, fontWeight: '600', marginBottom: 14 })}>{title}</Text>
          <TextInput
            autoFocus
            value={value}
            {...inputColors(theme)}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={theme.muted}
            secureTextEntry={secure}
            style={[styles.field, theme.font(16, { color: theme.text }), { backgroundColor: theme.dark ? '#000' : '#F1F2F4' }]}
            maxLength={maxLength}
            onSubmitEditing={confirm}
            submitBehavior="submit"
            returnKeyType="done"
          />
          <View style={styles.dialogButtons}>
            <Pressable onPress={onClose} hitSlop={8} style={styles.dialogBtn}>
              <Text style={theme.font(15, { color: theme.muted })}>{t('cancel')}</Text>
            </Pressable>
            <Pressable onPress={confirm} hitSlop={8} style={styles.dialogBtn} disabled={!ok}>
              <Text style={theme.font(15, { color: ok ? theme.accent : theme.outline, fontWeight: '600' })}>
                {confirmLabel ?? t('confirm')}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** 확인 대화상자(웹/데스크톱에서도 같은 모양으로 동작하도록 Alert 대신 사용) */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { theme, t } = useUi();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.center}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.dialog, { backgroundColor: theme.dark ? '#18191C' : '#FFFFFF' }]}>
          <Text style={theme.font(17, { color: theme.text, fontWeight: '600' })}>{title}</Text>
          {body ? <Text style={theme.font(14, { color: theme.muted, marginTop: 10, lineHeight: 21 })}>{body}</Text> : null}
          <View style={styles.dialogButtons}>
            <Pressable onPress={onClose} hitSlop={8} style={styles.dialogBtn}>
              <Text style={theme.font(15, { color: theme.muted })}>{t('cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onClose();
                onConfirm();
              }}
              hitSlop={8}
              style={styles.dialogBtn}
            >
              <Text style={theme.font(15, { color: danger ? theme.danger : theme.accent, fontWeight: '600' })}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** 화면 아래 잠깐 뜨는 알림(실행 취소 버튼 포함) */
export function ToastHost({ bottom }: { bottom: number }) {
  const { showToast, theme } = useUi();
  const toast = useToast();
  // 보이는 화면 하나만: 설정 하위 화면이 열려 있으면 그 밑의 홈에도 ToastHost가 있어 애니메이션·타이머가 둘씩 돌았다.
  // 가려진 화면에서 띄운 토스트는 돌아온 화면에서 새로 뜬다
  const focused = useIsFocused();
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!toast || !focused) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: Platform.OS !== 'web' }).start();
    const timer = setTimeout(() => showToast(null), toast.action ? 5000 : 2500);
    return () => clearTimeout(timer);
  }, [toast, focused, opacity, showToast]);
  if (!toast || !focused) return null;
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[styles.toast, { bottom, opacity, backgroundColor: '#2A2C30' }]}
    >
      <Text style={theme.font(14, { color: '#FFFFFF', flex: 1 })}>{toast.message}</Text>
      {toast.action ? (
        <Pressable
          hitSlop={10}
          onPress={() => {
            toast.action!.run();
            showToast(null);
          }}
        >
          <Text style={theme.font(14, { color: theme.accent, fontWeight: '600' })}>{toast.action.label}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

/** size: md(설정 시안 44×26) | sm(꾸미기 시안 39×22.5) */
export function Switch({ value, onChange, label, size = 'md' }: { value: boolean; onChange: (v: boolean) => void; label: string; size?: 'md' | 'sm' }) {
  const { theme } = useUi();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={[styles.switch, size === 'sm' && styles.switchSm, { backgroundColor: value ? theme.accent : theme.dark ? '#35393D' : theme.raised }]}
    >
      <View style={[styles.knob, size === 'sm' && styles.knobSm, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
    </Pressable>
  );
}

/** 0~1 슬라이더(웹·네이티브 공통, PanResponder) */
/** onChange는 끄는 동안 계속, onEnd는 손을 뗄 때 한 번(저장처럼 무거운 일은 onEnd에서) */
export function Slider({
  value,
  onChange,
  onEnd,
  label,
  style,
}: {
  value: number;
  onChange: (v: number) => void;
  onEnd?: (v: number) => void;
  label: string;
  style?: ViewStyle;
}) {
  const { theme } = useUi();
  const width = useRef(1);
  const startX = useRef(0);
  const last = useRef(value);
  // 끄는 동안 부르는 onChange는 늘 최신 것으로(처음 그릴 때의 onChange가 붙잡은 옛 설정값으로 되돌리지 않게)
  const onChangeRef = useRef(onChange);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onChangeRef.current = onChange;
    onEndRef.current = onEnd;
  });
  // 만드는 함수 안의 ref는 끌 때(이벤트) 읽는다. 그리는 중에 읽지 않는다(컴파일러 규칙의 오탐)
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => {
    const set = (x: number) => {
      last.current = Math.max(0, Math.min(1, x / width.current));
      onChangeRef.current(last.current);
    };
    const end = () => onEndRef.current?.(last.current);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        startX.current = e.nativeEvent.locationX;
        set(startX.current);
      },
      onPanResponderMove: (_e, g) => set(startX.current + g.dx),
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    });
  });
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const v = Math.max(0, Math.min(1, value + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)));
        onChange(v);
        onEnd?.(v);
      }}
      onLayout={(e) => (width.current = e.nativeEvent.layout.width || 1)}
      style={[styles.slider, style]}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={[styles.track, { backgroundColor: theme.raised }]}>
        <View style={{ width: `${value * 100}%`, height: '100%', borderRadius: 2, backgroundColor: theme.accent }} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: `${value * 100}%` }]} />
    </View>
  );
}

/** inset: 카드 [위, 아래] 안쪽 여백(설정 시안 3·4.5, 꾸미기 시안 3·1) */
export function Group({ title, children, style, inset = [3, 4.5] }: { title?: string; children: ReactNode; style?: ViewStyle; inset?: [number, number] }) {
  const { theme } = useUi();
  return (
    <View style={[{ marginBottom: 19.5 }, style]}>
      {title ? <Text style={theme.kfont(14.5, { color: theme.tab, marginLeft: 6.5, marginBottom: 5.5 })}>{title}</Text> : null}
      <View style={{ backgroundColor: theme.card, borderRadius: GROUP_RADIUS, overflow: 'hidden', paddingTop: inset[0], paddingBottom: inset[1] }}>{children}</View>
    </View>
  );
}

export function Row({
  label,
  value,
  icon,
  onPress,
  right,
  danger,
  last,
  size = 'md',
}: {
  label: string;
  value?: string;
  icon?: ReactNode;
  onPress?: () => void;
  right?: ReactNode;
  danger?: boolean;
  last?: boolean;
  /** md: 설정 시안(줄 53.5 + 카드 안쪽 4, 글자 16.5) | sm: 꾸미기 시안(줄 52.7 + 카드 안쪽 2, 글자 15.5) */
  size?: 'md' | 'sm';
}) {
  const { theme } = useUi();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, size === 'sm' && { minHeight: 52.7 }, pressed && onPress ? { backgroundColor: theme.cardPressed } : null]}
    >
      {icon ? <View style={{ width: 26, alignItems: 'center', marginLeft: 0.5, marginRight: 21.5 }}>{icon}</View> : null}
      <Text style={theme.kfont(size === 'sm' ? 15.5 : 16.5, { color: danger ? theme.danger : theme.text, flex: 1 })}>{label}</Text>
      {value ? <Text style={theme.kfont(size === 'sm' ? 14 : 13, { color: theme.subtle, marginRight: size === 'sm' ? 10 : 3 })}>{value}</Text> : null}
      {right ?? (onPress ? (
        <View style={{ marginRight: size === 'sm' ? -3.5 : -6.5 }}>
          <ChevronIcon color={theme.subtle} size={size === 'sm' ? 17 : 20} strokeWidth={1.7} />
        </View>
      ) : null)}
      {!last ? <View style={[styles.rowLine, { backgroundColor: theme.dark ? '#2A2D33' : '#E7E9ED', left: 18.5, right: 18 }]} /> : null}
    </Pressable>
  );
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  const { theme } = useUi();
  // 고른 칸의 바탕이 새 칸으로 미끄러진다(하단바와 같은 움직임)
  const { onItemLayout, pill } = useSlidingPill(options.findIndex((o) => o.value === value));
  return (
    <View style={[styles.segment, { backgroundColor: theme.dark ? '#141518' : '#EEF0F3' }]}>
      {pill ? <Animated.View pointerEvents="none" style={[styles.segmentPill, pill, { backgroundColor: theme.raised }]} /> : null}
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            onLayout={onItemLayout(i)}
            style={styles.segmentItem}
          >
            <Text style={theme.font(14, { color: on ? theme.text : theme.muted, fontWeight: on ? '600' : '400' })}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 시안의 묶음·카드 모서리(설정·공유·꾸미기 시안에서 잰 값 13.5~14.5) */
const GROUP_RADIUS = 14;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { marginHorizontal: 10, borderRadius: 24, paddingBottom: 8, overflow: 'hidden', width: '95%', maxWidth: 560, alignSelf: 'center' },
  sheetBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, minHeight: 52 },
  infoRow: { flexDirection: 'row', paddingHorizontal: 22, paddingVertical: 7 },
  center: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  dialog: { borderRadius: 22, padding: 22, maxWidth: 440, width: '100%', alignSelf: 'center' },
  field: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18, gap: 8 },
  dialogBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    maxWidth: 560,
    alignSelf: 'center',
    marginHorizontal: 'auto',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  switch: { width: 44, height: 26, borderRadius: 13, padding: 2.5, justifyContent: 'center' },
  knob: { width: 21, height: 21, borderRadius: 10.5, backgroundColor: '#FFFFFF' },
  switchSm: { width: 39, height: 22.5, borderRadius: 11.25, padding: 2 },
  knobSm: { width: 18.5, height: 18.5, borderRadius: 9.25 },
  slider: { height: 36, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  thumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    marginLeft: -9,
    top: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.25)',
    boxShadow: '0px 1px 3px rgba(0,0,0,0.3)',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 18.5, paddingRight: 18, minHeight: 53.5 },
  rowLine: { position: 'absolute', bottom: 0, height: StyleSheet.hairlineWidth },
  segment: { flexDirection: 'row', borderRadius: 14, padding: 4 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  segmentPill: { top: 4, bottom: 4, borderRadius: 10 },
});
