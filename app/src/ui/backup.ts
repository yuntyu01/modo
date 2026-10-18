import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { desktop } from '../native/bridge';

/** JSON 백업을 파일로 내보낸다. 모바일은 시스템 공유(드라이브·메일 등), 데스크톱은 저장 대화상자. */
export async function saveBackup(name: string, json: string): Promise<boolean> {
  if (Platform.OS === 'web') return desktop ? desktop.saveFile(name, json) : false;
  const file = new File(Paths.cache, name);
  file.write(json);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: name, UTI: 'public.json' });
  return true;
}

export async function pickBackup(): Promise<string | null> {
  if (Platform.OS === 'web') return desktop ? desktop.openFile() : null;
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.[0]) return null;
  return new File(r.assets[0].uri).text();
}
