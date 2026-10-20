import { useRef, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useUi } from '../../state/AppContext';
import { desktop } from '../../native/bridge';
import { useWide } from '../layout';
import { useTabScroller } from '../home/tabScroller';

/**
 * 함께 탭의 줄 하나(친구 줄·함께 쓰는 폴더 줄): 고른 것만 굵고 진하게, 나머지는 중간 회색(칩·밑줄·사진 없이).
 * 넘치면 이 줄만 옆으로 밀리고 고른 것을 가운데로. 오른쪽 끝에는 고정된 것(친구 추가 +, '보기만'·'함께 편집')을 둔다.
 * 폴더 줄(level 'folder')은 친구 줄보다 한 단계 작은 글자, 누르는 자리는 그대로 넉넉하게.
 * 길게 누르기(PC는 오른쪽 클릭)는 관리 메뉴. 아주 긴 이름은 한 칸이 줄을 다 차지하지 않게 줄인다.
 */
export function TabRow({
  items,
  selected,
  onSelect,
  onLongPress,
  right,
  level,
}: {
  items: { key: string; label: string }[];
  selected: string | null;
  onSelect: (key: string) => void;
  onLongPress?: (key: string) => void;
  right?: ReactNode;
  /** friend: 로고 바로 아래 줄(홈 폴더 줄과 같은 위 여백) | folder: 그 아래 한 단계 작은 줄 */
  level: 'friend' | 'folder';
}) {
  const { theme } = useUi();
  const { compact, width } = useWide();
  const scrollRef = useRef<ScrollView>(null);
  const scroller = useTabScroller(scrollRef, selected ?? '', 0);
  const first = level === 'friend';
  // 모바일 기준 친구 17sp·폴더 14.5sp, PC 16·14
  const size = (desktop ? (first ? 16 : 14) : first ? 17 : 14.5) * theme.zoom;
  const gap = (desktop ? (first ? 30 : 26) : first ? 28 : 24) * theme.zoom;
  return (
    <View
      style={[
        styles.row,
        first ? styles.first : styles.second,
        desktop && { paddingLeft: 25.8, paddingRight: 22, marginRight: first ? 128 : 0 },
        compact && { paddingTop: first ? 6 : 2, paddingBottom: first ? 2 : 8 },
      ]}
    >
      <ScrollView
        ref={scrollRef}
        onLayout={scroller.onLayout}
        onScroll={scroller.onScroll}
        onContentSizeChange={scroller.onContentSizeChange}
        scrollEventThrottle={32}
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'center' }}
        style={{ flex: 1 }}
      >
        {items.map(({ key, label }) => {
          const on = key === selected;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label}
              onPress={scroller.guard(() => onSelect(key))}
              onLongPress={onLongPress ? () => onLongPress(key) : undefined}
              {...((Platform.OS === 'web' && onLongPress
                ? {
                    onContextMenu: (e: { preventDefault: () => void }) => {
                      e.preventDefault();
                      onLongPress(key);
                    },
                  }
                : null) as object)}
              onLayout={scroller.tabLayout(key)}
              // 글씨가 작아도 누르는 자리는 44dp 안팎
              hitSlop={{ top: first ? 12 : 14, bottom: first ? 12 : 14, left: 8, right: 8 }}
              style={{ marginRight: gap, maxWidth: Math.max(140, width * 0.55) }}
            >
              <Text
                selectable={false}
                numberOfLines={1}
                style={theme.kfont(size, { color: on ? theme.text : theme.tab, fontWeight: on ? '700' : '400', ...(desktop ? { lineHeight: first ? 20 : 18 } : null) })}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {right ? <View style={{ marginLeft: 12, flexShrink: 0 }}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 24.5, paddingRight: 22.5 },
  first: { paddingTop: 19.5, paddingBottom: 0 },
  // 두 줄 사이 약 14dp
  second: { paddingTop: 14, paddingBottom: 14 },
});
