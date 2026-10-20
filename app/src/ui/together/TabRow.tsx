import { useRef, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useUi } from '../../state/AppContext';
import { desktop } from '../../native/bridge';
import { useWide } from '../layout';
import { useTabScroller } from '../home/tabScroller';

/**
 * 함께 탭의 줄 하나(친구 줄·함께 쓰는 폴더 줄): 홈 폴더 줄과 같은 글자·간격으로 고른 것만 굵고 진하게.
 * 넘치면 옆으로 밀리고 고른 것을 가운데로. 오른쪽 끝에는 고정된 것(친구 추가 +, '함께 편집')을 둔다.
 */
export function TabRow({
  items,
  selected,
  onSelect,
  onLongPress,
  right,
  first,
}: {
  items: { key: string; label: string }[];
  selected: string | null;
  onSelect: (key: string) => void;
  onLongPress?: (key: string) => void;
  right?: ReactNode;
  /** 맨 위 줄(로고 바로 아래)이면 위 여백을 홈 폴더 줄과 같게 */
  first?: boolean;
}) {
  const { theme } = useUi();
  const { compact } = useWide();
  const scrollRef = useRef<ScrollView>(null);
  const scroller = useTabScroller(scrollRef, selected ?? '', 0);
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
              onPress={scroller.guard(() => onSelect(key))}
              onLongPress={onLongPress ? () => onLongPress(key) : undefined}
              onLayout={scroller.tabLayout(key)}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              style={{ marginRight: desktop ? 33 : 32 * theme.zoom }}
            >
              <Text
                selectable={false}
                numberOfLines={1}
                style={theme.kfont((desktop ? 16 : 18) * theme.zoom, { color: on ? theme.text : theme.tab, fontWeight: on ? '700' : '400', ...(desktop ? { lineHeight: 20 } : null) })}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {right ? <View style={{ marginLeft: 12 }}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 24.5, paddingRight: 22.5 },
  first: { paddingTop: 19.5, paddingBottom: 6 },
  second: { paddingTop: 12, paddingBottom: 15 },
});
