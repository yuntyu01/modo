import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * PC(웹): 옆으로 밀기가 없다(마우스로 끌면 글자 선택과 겹쳐 오른쪽 클릭 메뉴로 지운다). 휴대폰용(SwipeToDelete.tsx)은 카드마다
 * 애니메이션 값·제스처·창 크기 구독을 만들고 나서 그냥 View를 돌려줬는데, 미니창 높이가 바뀌는 동안 창 크기 구독 때문에
 * 모든 카드가 프레임마다 다시 그려졌다. 여기선 감싸기만 한다.
 */
export function SwipeToDelete({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode } & Record<string, unknown>) {
  return <View style={style}>{children}</View>;
}
