import { Platform, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native';

/**
 * PC(웹): react-native-web는 여러 줄 입력칸의 submitBehavior를 몰라서 엔터가 그냥 줄바꿈이 된다.
 * 한글 조합 중이 아니고 Shift 없이 누른 엔터면 줄바꿈을 막고 지금 글로 onEnter를 부른다. 처리했으면 true.
 * (조합 중 엔터는 글자 확정에만 쓰이고, 확정 뒤 엔터가 다시 오면 그때 제출된다)
 */
export function handleWebEnter(e: NativeSyntheticEvent<TextInputKeyPressEventData>, onEnter: (text: string) => void) {
  if (Platform.OS !== 'web') return false;
  const ne = e.nativeEvent as unknown as { key: string; isComposing?: boolean; keyCode?: number; shiftKey?: boolean };
  if (ne.key !== 'Enter' || ne.shiftKey || ne.isComposing || ne.keyCode === 229) return false;
  e.preventDefault();
  onEnter((e.target as unknown as { value?: string }).value ?? '');
  return true;
}
