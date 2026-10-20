import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { errorText } from '../../i18n';
import { useApp } from '../../state/AppContext';
import { personName, useFriends, type Friend } from '../../state/friends';
import { liveFolders } from '../home/model';
import { Sheet, SheetButton, SheetTitle } from '../primitives';

/**
 * 친구에게 내 폴더 공유하기: 폴더 고르기 → 권한(함께 편집·보기만). 친구 관계와 공유 권한은 따로라, 친구에게도 폴더마다 이렇게 공유한다.
 * 공유받은 폴더(남의 폴더)와 이미 이 친구와 함께 쓰는 폴더는 고를 수 없다. 기본 폴더는 공유하지 않는다.
 */
export function ShareWithFriendSheet({ friend, onClose, onShared }: { friend: Friend | null; onClose: () => void; onShared: (folderId: string) => void }) {
  const { t, snap, showToast } = useApp();
  const friends = useFriends();
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = useMemo(() => {
    const foreign = new Set(snap.shared.map((s) => s.folder_id));
    const already = new Set(friend?.folders.map((f) => f.folder_id) ?? []);
    return liveFolders(snap.folders).filter((f) => !foreign.has(f.id) && !already.has(f.id));
  }, [snap.folders, snap.shared, friend]);
  const close = () => {
    setFolder(null);
    onClose();
  };
  if (!friend) return null;
  const name = personName(friend);
  const share = async (role: 'view' | 'edit') => {
    if (!folder || busy) return;
    setBusy(true);
    try {
      await friends.shareFolder(folder, friend.id, role);
      showToast({ message: t('sharedWithFriend', { name }) });
      onShared(folder);
      close();
    } catch (e) {
      showToast({ message: errorText(e, t) });
    } finally {
      setBusy(false);
    }
  };
  const picked = mine.find((f) => f.id === folder);
  return (
    <Sheet visible onClose={close}>
      {picked ? (
        <>
          <SheetTitle title={t('permission')} subtitle={picked.name} />
          <SheetButton label={t('roleEditLong')} onPress={() => void share('edit')} disabled={busy} />
          <SheetButton label={t('roleViewLong')} onPress={() => void share('view')} disabled={busy} />
        </>
      ) : (
        <>
          <SheetTitle title={t('shareFolderWithFriendTitle', { name })} subtitle={mine.length ? undefined : t('noFolderToShare')} />
          {mine.map((f) => (
            <SheetButton key={f.id} label={f.name} onPress={() => setFolder(f.id)} />
          ))}
        </>
      )}
      {/* 시트 아래 여백(마지막 버튼이 둥근 모서리에 붙지 않게) */}
      <View style={{ height: 10 }} />
    </Sheet>
  );
}
