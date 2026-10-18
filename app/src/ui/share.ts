import * as Clipboard from 'expo-clipboard';
import { Platform, Share } from 'react-native';

import type { Paragraph, Todo } from '../core/types';

/** 시스템 공유(데스크톱은 클립보드 복사). 넘긴 텍스트만 나가고 나머지 메모는 포함되지 않는다. */
export async function shareText(text: string): Promise<'shared' | 'copied'> {
  if (Platform.OS === 'web') {
    await Clipboard.setStringAsync(text);
    return 'copied';
  }
  await Share.share({ message: text });
  return 'shared';
}

export function folderAsText(name: string, paragraphs: Paragraph[], todos: Todo[]) {
  const memo = paragraphs.map((p) => p.text).join('\n');
  const list = todos.map((t) => `${t.done ? '☑' : '☐'} ${t.text}`).join('\n');
  return [name, memo, list].filter(Boolean).join('\n\n');
}
