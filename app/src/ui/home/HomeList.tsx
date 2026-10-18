import { memo, useCallback, useRef, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import ReorderableList, { reorderItems, useIsActive, useReorderableDrag } from 'react-native-reorderable-list';
import { scheduleOnRN } from 'react-native-worklets';

import type { Block } from './model';

export type HomeListProps = {
  blocks: Block[];
  dragEnabled: boolean;
  isDraggable: (b: Block) => boolean;
  renderBlock: (b: Block, opts: { onLongPress: (info: () => void) => void; active: boolean }) => ReactElement;
  onMove: (blocks: Block[], to: number) => void;
  header?: ReactElement;
  footer?: ReactElement;
  bottomPad: number;
};

/**
 * 홈 목록(Android/iOS). 길게 눌러 그대로 끌면 순서 변경, 움직이지 않고 떼면 항목 정보.
 */
export function HomeList(p: HomeListProps) {
  const pendingInfo = useRef<(() => void) | null>(null);

  const dragEnd = useCallback((from: number, to: number) => {
    const info = pendingInfo.current;
    pendingInfo.current = null;
    if (from === to) info?.();
  }, []);
  // 길게 누른 뒤 움직이지 않고 떼면 보여 줄 정보(끌기가 끝날 때 꺼내 쓴다)
  const setPending = useCallback((fn: (() => void) | null) => {
    pendingInfo.current = fn;
  }, []);

  return (
    <ReorderableList
      data={p.blocks}
      keyExtractor={(b) => b.key}
      dragEnabled={p.dragEnabled}
      shouldUpdateActiveItem
      cellAnimations={{ opacity: 1 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
      contentContainerStyle={[styles.content, { paddingBottom: p.bottomPad }]}
      ListHeaderComponent={p.header}
      ListFooterComponent={p.footer}
      onReorder={({ from, to }) => {
        if (from === to) return;
        p.onMove(reorderItems(p.blocks, from, to), to);
      }}
      onDragEnd={({ from, to }) => {
        'worklet';
        scheduleOnRN(dragEnd, from, to);
      }}
      renderItem={({ item }) => (
        <Item block={item} draggable={p.dragEnabled && p.isDraggable(item)} render={p.renderBlock} setPending={setPending} />
      )}
    />
  );
}

const Item = memo(function Item({
  block,
  draggable,
  render,
  setPending,
}: {
  block: Block;
  draggable: boolean;
  render: HomeListProps['renderBlock'];
  setPending: (fn: (() => void) | null) => void;
}) {
  const drag = useReorderableDrag();
  const active = useIsActive();
  // 같은 함수를 유지해야 카드(memo)가 다시 그려지지 않는다
  const onLongPress = useCallback(
    (info: () => void) => {
      if (!draggable) return info();
      setPending(info);
      drag();
    },
    [draggable, drag, setPending],
  );
  return <View>{render(block, { onLongPress, active })}</View>;
});

const styles = StyleSheet.create({
  // 좌우 여백 15(반복 할 일 시안: 카드·입력창이 화면 양쪽에서 약 15)
  content: { paddingHorizontal: 15 },
});
