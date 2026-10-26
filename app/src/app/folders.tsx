import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '../state/AppContext';
import { EditIcon, PeopleIcon, PlusIcon, ShareIcon, TrashIcon } from '../ui/Icons';
import { ItemSheets, type SheetState } from '../ui/ItemSheets';
import { Group, Row } from '../ui/primitives';
import { Note, SubScreen } from '../ui/SubScreen';
import { hiddenFolderIds, liveFolderIds, liveFolders, todoInView } from '../ui/home/model';

/**
 * 폴더 관리: 폴더 추가 · 이름 바꾸기 · 삭제 · 공유(서버에 닿을 때만) 를 한곳에서.
 * 전체(예전 '기본' 폴더: 모든 폴더의 할 일 + 폴더 없는 메모·할 일)는 지울 수 없고, 공유받은 폴더는 이름·삭제 없이 공유 표시만 한다.
 */
export default function Folders() {
  const { theme, t, snap, serverApi, account } = useApp();
  const [sheet, setSheet] = useState<SheetState>(null);
  const folders = liveFolders(snap.folders);
  const sharedIds = new Set(snap.shared.map((s) => s.folder_id));
  const count = (id: string) => snap.todos.filter((x) => x.folder_id === id && !x.deleted_at && !x.done).length;
  // 전체 탭에 보이는 남은 할 일(홈에서 숨긴 공유 폴더 것은 빼고)
  const live = liveFolderIds(snap.folders);
  const hidden = hiddenFolderIds(snap.shared);
  const baseCount = snap.todos.filter((x) => !x.deleted_at && !x.done && todoInView(x.folder_id, null, live, hidden)).length;
  const iconBtn = (label: string, icon: ReactNode, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={styles.icon}>
      {icon}
    </Pressable>
  );
  return (
    <SubScreen title={t('manageFolders')}>
      <Group>
        {/* 남은 할 일 수는 이름 아래 작은 줄로(예전엔 아이콘 옆 숫자만 있어 무엇의 수인지 애매했다, 사용자 의견 2026-10-26).
            전체는 고치기·지우기가 없어 아이콘 없이 '모든 폴더' */}
        <Row
          label={t('baseFolder')}
          sub={baseCount ? `${t('allFoldersSub')} · ${t('todoLeft', { n: baseCount })}` : t('allFoldersSub')}
          last={!folders.length}
          right={<View />}
        />
        {folders.map((f, i) => {
          const mine = !sharedIds.has(f.id);
          return (
            <Row
              key={f.id}
              label={f.name}
              sub={count(f.id) ? t('todoLeft', { n: count(f.id) }) : undefined}
              onPress={mine ? () => setSheet({ type: 'rename', id: f.id }) : undefined}
              last={i === folders.length - 1}
              right={
                <View style={styles.actions}>
                  {!mine ? <PeopleIcon color={theme.subtle} size={19} /> : null}
                  {mine ? iconBtn(t('rename'), <EditIcon color={theme.subtle} size={19} />, () => setSheet({ type: 'rename', id: f.id })) : null}
                  {/* 계정으로 함께 쓰기는 서버가 있어야 해서, 서버에 닿고 로그인했을 때만 */}
                  {mine && serverApi && account
                    ? iconBtn(t('share'), <ShareIcon color={theme.subtle} size={19} />, () => router.push({ pathname: '/share/[id]', params: { id: f.id } }))
                    : null}
                  {mine ? iconBtn(t('delete'), <TrashIcon color={theme.danger} size={19} />, () => setSheet({ type: 'deleteFolder', id: f.id })) : null}
                </View>
              }
            />
          );
        })}
      </Group>
      <Pressable accessibilityRole="button" onPress={() => setSheet({ type: 'newFolder' })} style={({ pressed }) => [styles.add, { backgroundColor: pressed ? theme.cardPressed : theme.card }]}>
        <PlusIcon color={theme.accent} size={20} strokeWidth={1.9} />
        <Text style={theme.kfont(16, { color: theme.accent, fontWeight: '600' })}>{t('addFolder')}</Text>
      </Pressable>
      <Note>{t('deleteFolderBody')}</Note>
      <ItemSheets state={sheet} setState={setSheet} />
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: -6 },
  icon: { padding: 6 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14.5, height: 52, marginBottom: 12 },
});
