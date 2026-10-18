import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useApp } from '../state/AppContext';
import { withAlpha } from './color';

export type MenuItem = { label: string; onPress: () => void; icon?: ReactNode; danger?: boolean };

/**
 * ⋯ 버튼 바로 아래 오른쪽에 붙어 펼쳐지는 작은 메뉴(아래에서 올라오는 시트 대신).
 * anchor(누른 버튼)의 화면 위치를 재서 그 아래에 둔다. 바깥을 누르거나 항목을 고르면 닫힌다.
 * 메뉴는 뒤가 비치면 글자가 겹쳐 읽기 어려워 불투명하게.
 */
export function Dropdown({
  visible,
  onClose,
  anchor,
  title,
  items,
}: {
  visible: boolean;
  onClose: () => void;
  anchor: View | null;
  /** 맨 위 작은 회색 글자(예: 지금 폴더 이름) */
  title?: string;
  items: (MenuItem | null | false)[];
}) {
  const { theme, t } = useApp();
  const { width } = useWindowDimensions();
  const [measured, setMeasured] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (visible && anchor) anchor.measureInWindow((x, y, w, h) => setMeasured({ top: y + h + 6, right: Math.max(8, width - (x + w) - 4) }));
  }, [visible, anchor, width]);
  // 버튼을 못 받았으면 오른쪽 위
  const pos = anchor ? measured : { top: 60, right: 16 };
  const list = items.filter(Boolean) as MenuItem[];
  return (
    <Modal visible={visible && !!pos} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('cancel')} />
      {pos ? (
        <View
          accessibilityRole="menu"
          style={[styles.box, { top: pos.top, right: pos.right, backgroundColor: theme.dark ? '#25272C' : '#FFFFFF', shadowOpacity: theme.dark ? 0.5 : 0.16 }]}
        >
          {title ? (
            <Text numberOfLines={1} style={[styles.title, theme.font(12.5, { color: theme.muted })]}>
              {title}
            </Text>
          ) : null}
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
                (pressed || hovered) && { backgroundColor: withAlpha(theme.text, 0.07) },
              ]}
            >
              {it.icon ? <View style={styles.icon}>{it.icon}</View> : null}
              <Text style={theme.font(Platform.OS === 'web' ? 15 : 15.5, { color: it.danger ? theme.danger : theme.text })}>{it.label}</Text>
            </Pressable>
          ))}
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
  title: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 4 },
  item: { flexDirection: 'row', alignItems: 'center', minHeight: 42, paddingHorizontal: 12, marginHorizontal: 6, borderRadius: 9 },
  icon: { marginRight: 12 },
});
