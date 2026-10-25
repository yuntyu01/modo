import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useUi } from '../state/AppContext';
import { withAlpha } from './color';

export type MenuItem = { label: string; onPress: () => void; icon?: ReactNode; danger?: boolean };

/**
 * ⋯ 버튼 바로 아래 오른쪽에 붙어 펼쳐지는 작은 메뉴(아래에서 올라오는 시트 대신).
 * anchor(누른 버튼)의 화면 위치를 재서 그 아래에 둔다. 바깥을 누르거나 항목을 고르면 닫힌다.
 * point를 주면(PC 오른쪽 클릭) 그 자리에서 오른쪽 아래로 펼치고, 창 밖으로 나가면 안쪽으로 당긴다.
 * 메뉴는 뒤가 비치면 글자가 겹쳐 읽기 어려워 불투명하게.
 */
export function Dropdown({
  visible,
  onClose,
  anchor,
  point,
  title,
  items,
}: {
  visible: boolean;
  onClose: () => void;
  anchor?: View | null;
  point?: { x: number; y: number };
  /** 맨 위 작은 회색 글자(예: 지금 폴더 이름) */
  title?: string;
  items: (MenuItem | null | false)[];
}) {
  const { theme, t } = useUi();
  const { width, height } = useWindowDimensions();
  const [measured, setMeasured] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (visible && anchor) anchor.measureInWindow((x, y, w, h) => setMeasured({ top: y + h + 6, right: Math.max(8, width - (x + w) - 4) }));
  }, [visible, anchor, width]);
  // 누른 자리에 펼칠 때: 크기를 잰 뒤 창 안으로(재기 전에는 보이지 않게)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const atPoint = point
    ? size
      ? { left: Math.max(8, Math.min(point.x, width - size.w - 8)), top: Math.max(8, Math.min(point.y, height - size.h - 8)) }
      : { left: point.x, top: point.y, opacity: 0 }
    : null;
  // PC: Esc로 닫는다(react-native-web Modal의 Esc는 맨 위 창으로 잡힌 경우에만 닫아, 큰 창에서는 닫히지 않을 때가 있었다)
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, onClose]);
  // 버튼을 못 받았으면 오른쪽 위
  const pos = atPoint ?? (anchor ? measured : { top: 60, right: 16 });
  const list = items.filter(Boolean) as MenuItem[];
  return (
    <Modal visible={visible && !!pos} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel={t('cancel')}
        // PC: 메뉴 바깥을 오른쪽 클릭해도 닫는다
        {...(Platform.OS === 'web'
          ? {
              onContextMenu: (e: { preventDefault: () => void }) => {
                e.preventDefault();
                onClose();
              },
            }
          : null)}
      />
      {pos ? (
        <View
          accessibilityRole="menu"
          onLayout={point ? (e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }) : undefined}
          style={[
            styles.box,
            pos,
            { backgroundColor: theme.dark ? '#25272C' : '#FFFFFF', shadowOpacity: theme.dark ? 0.5 : 0.16 },
            // PC: react-native-web은 위 그림자를 번짐 없이 그려(0px 0px 0px) 흰 바탕 위에서 메뉴 가장자리가 보이지 않았다. 그림자와 옅은 테두리를 직접
            Platform.OS === 'web' && {
              boxShadow: theme.dark ? '0 10px 28px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.07)' : '0 10px 28px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.06)',
            },
            point && styles.pointBox,
            point && { maxHeight: height - 16 },
          ]}
        >
          {title ? (
            <Text numberOfLines={1} style={[styles.title, theme.font(12.5, { color: theme.muted })]}>
              {title}
            </Text>
          ) : null}
          <ScrollView bounces={false} style={{ flexGrow: 0 }}>
            {list.map((it) => (
              <Pressable
                key={it.label}
                accessibilityRole="menuitem"
                onPress={() => {
                  onClose();
                  it.onPress();
                }}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.item,
                  point && styles.pointItem,
                  (pressed || hovered) && { backgroundColor: withAlpha(theme.text, 0.07) },
                ]}
              >
                {it.icon ? <View style={styles.icon}>{it.icon}</View> : null}
                <Text style={theme.font(point ? 14 : Platform.OS === 'web' ? 15 : 15.5, { color: it.danger ? theme.danger : theme.text })}>{it.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    minWidth: 210,
    maxWidth: 300,
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    elevation: 14,
  },
  // 오른쪽 클릭 메뉴: PC 메뉴처럼 조금 촘촘하게
  pointBox: { minWidth: 200, maxWidth: 260, borderRadius: 12, paddingVertical: 5 },
  title: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 4 },
  item: { flexDirection: 'row', alignItems: 'center', minHeight: 42, paddingHorizontal: 12, marginHorizontal: 6, borderRadius: 9 },
  pointItem: { minHeight: 34, paddingHorizontal: 10, marginHorizontal: 5, borderRadius: 7 },
  icon: { marginRight: 12 },
});
