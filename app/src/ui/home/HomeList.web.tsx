import { FlatList } from 'react-native';

import type { HomeListProps } from './HomeList';
import type { Block } from './model';

/**
 * 데스크톱(웹 렌더링): 끌어서 정렬은 모바일 홈 화면 기능이라 여기선 길게 누르면 바로 항목 정보.
 * 보이는 부분만 그린다(가상화): 할 일이 수백 개인 폴더로 바꿀 때 카드를 전부 다시 그려 100ms쯤 멈췄다(2026-10-18 측정).
 */
export function HomeList(p: HomeListProps) {
  return (
    <FlatList
      data={p.blocks}
      keyExtractor={keyOf}
      renderItem={({ item }) => p.renderBlock(item, WEB_OPTS)}
      // 첫 화면을 채울 만큼 먼저, 나머지는 스크롤하며(PC 창 높이 700에 카드 48 + 간격 8 기준 넉넉히)
      initialNumToRender={16}
      maxToRenderPerBatch={16}
      windowSize={7}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 23.5, paddingBottom: p.bottomPad }}
      ListHeaderComponent={p.header}
      ListFooterComponent={p.footer}
    />
  );
}

const keyOf = (b: Block) => b.key;
// 늘 같은 함수(카드는 memo라 길게 누르기 함수가 바뀌면 다시 그려진다. 예전엔 그릴 때마다 새로 만들어 보이는 카드가 전부 다시 그려졌다)
const WEB_OPTS = { onLongPress: (info: () => void) => info(), active: false };
