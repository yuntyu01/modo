import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '../../state/AppContext';
import { personName, useFriends } from '../../state/friends';
import { Dropdown } from '../../ui/Dropdown';
import { ItemSheets, type SheetState } from '../../ui/ItemSheets';
import type { Editing } from '../../ui/home/Cards';
import { FolderBody } from '../../ui/home/FolderBody';
import { HomeHeader, SearchBar } from '../../ui/home/Header';
import { PeopleIcon, PlusIcon } from '../../ui/Icons';
import { useBottomInset, useWide } from '../../ui/layout';
import { ConfirmDialog } from '../../ui/primitives';
import { AddFriendSheet } from '../../ui/together/AddFriendSheet';
import { ShareWithFriendSheet } from '../../ui/together/ShareWithFriendSheet';
import { TabRow } from '../../ui/together/TabRow';
import { mix } from '../../ui/color';

/**
 * 함께(시안): 로고 → 친구 줄(+ 친구 추가, 받은 요청이 있으면 점) → 그 친구와 함께 쓰는 폴더 줄('함께 편집'·'보기만') →
 * 그 폴더의 메모·할 일·입력창(홈과 같은 FolderBody). 친구 관계와 폴더 공유 권한은 따로라:
 * - 친구가 되어도 아무것도 보이지 않는다. 폴더 줄에는 그 친구가 내게 공유한 폴더와 내가 그 친구에게 공유한 폴더만.
 * - 쓰기는 공유 권한대로(보기만이면 입력창이 잠긴다, 서버도 다시 확인). 권한은 폴더 주인이 폴더 공유 설정에서 바꾼다.
 * - 친구를 끊어도 공유는 그대로다.
 */
export default function Together() {
  const { snap, prefs, setPrefs, t, theme, showToast, sync } = useApp();
  const friends = useFriends();
  const [friendId, setFriendId] = useState<string | null>(null);
  const [folderByFriend, setFolderByFriend] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Editing>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menu, setMenu] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<View | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { compact } = useWide();
  const navInset = useBottomInset();

  const list = friends.data.friends;
  const friend = list.find((f) => f.id === friendId) ?? list[0] ?? null;
  const folderNames = useMemo(() => new Map(snap.folders.filter((f) => !f.deleted_at).map((f) => [f.id, f.name])), [snap.folders]);
  // 이 기기에 있는(동기화된) 폴더만. 방금 공유받아 아직 없는 폴더는 한 번 동기화해서 받는다
  const shared = useMemo(() => (friend ? friend.folders.filter((ff) => folderNames.has(ff.folder_id)) : []), [friend, folderNames]);
  const missing = friend ? friend.folders.filter((ff) => !folderNames.has(ff.folder_id)).map((ff) => ff.folder_id).join(',') : '';
  const synced = useRef('');
  useEffect(() => {
    if (!missing || synced.current === missing) return;
    synced.current = missing;
    void sync.syncNow();
  }, [missing, sync]);

  const current = (friend && shared.find((ff) => ff.folder_id === folderByFriend[friend.id])) ?? shared[0] ?? null;
  const order = useMemo(() => shared.map((ff) => ff.folder_id), [shared]);
  const incoming = friends.data.incoming.length;
  const name = friend ? personName(friend) : '';

  const roleLabel = current ? (current.role === 'edit' ? t('editTogether') : current.mine ? t('viewOnlyShared') : t('readOnly')) : '';
  const onRole = () => {
    if (!current) return;
    // 내 폴더면 공유 설정(권한 바꾸기·끊기), 친구 폴더면 누가 공유했는지
    if (current.mine) router.push(`/share/${current.folder_id}`);
    else showToast({ message: t('sharedByFriend', { name }) });
  };

  const addButton = (
    <Pressable accessibilityLabel={t('friendsAdd')} accessibilityRole="button" onPress={() => setAdding(true)} hitSlop={12} style={styles.add}>
      <PlusIcon color={theme.tab} size={22 * theme.zoom} strokeWidth={1.7} />
      {incoming ? <View style={[styles.dot, { backgroundColor: theme.accent }]} /> : null}
    </Pressable>
  );

  const empty = (title: string, action: string, onAction: () => void) => (
    <View style={[styles.empty, { paddingBottom: navInset + 40 }]}>
      <View style={[styles.emptyIcon, { backgroundColor: mix(theme.bg, theme.accent, 0.12) }]}>
        <PeopleIcon color={theme.accent} size={30} />
      </View>
      <Text style={theme.kfont(17, { color: theme.text, fontWeight: '600', textAlign: 'center', marginTop: 18 })}>{title}</Text>
      <Text style={theme.kfont(14.5, { color: theme.muted, textAlign: 'center', marginTop: 8 })}>{t('friendsNote')}</Text>
      <Pressable accessibilityRole="button" onPress={onAction} style={[styles.emptyBtn, { backgroundColor: mix(theme.bg, theme.accent, 0.16) }]}>
        <Text style={theme.kfont(15.5, { color: theme.accent, fontWeight: '600' })}>{action}</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {/* 글을 쓰다 머리의 빈 곳을 눌러도 키보드를 닫는다(홈과 같다) */}
      <View onStartShouldSetResponder={() => Keyboard.isVisible()} onResponderRelease={() => Keyboard.dismiss()}>
        <HomeHeader
          onMenu={(a) => {
            setMenuAnchor(a);
            setMenu(true);
          }}
          onSearch={current ? () => setSearch(search === null ? '' : null) : undefined}
        />
      </View>
      {search !== null && current ? <SearchBar value={search} onChange={setSearch} onClose={() => setSearch(null)} /> : null}
      <TabRow
        first
        items={list.map((f) => ({ key: f.id, label: personName(f) }))}
        selected={friend?.id ?? null}
        onSelect={(id) => {
          setEditing(null);
          setFriendId(id);
        }}
        onLongPress={(id) => {
          setFriendId(id);
          setConfirmRemove(true);
        }}
        right={addButton}
      />
      {friend && shared.length ? (
        <TabRow
          items={shared.map((ff) => ({ key: ff.folder_id, label: folderNames.get(ff.folder_id) ?? '' }))}
          selected={current?.folder_id ?? null}
          onSelect={(id) => {
            setEditing(null);
            setFolderByFriend((m) => ({ ...m, [friend.id]: id }));
          }}
          right={
            <Pressable accessibilityRole="button" onPress={onRole} hitSlop={10}>
              <Text style={theme.kfont(compact ? 13 : 14, { color: theme.muted })}>{roleLabel}</Text>
            </Pressable>
          }
        />
      ) : null}

      {!friend
        ? empty(t('friendsEmpty'), t('friendsAdd'), () => setAdding(true))
        : !current
          ? empty(t('friendNoFolders', { name }), t('shareFolderWithFriend'), () => setSharing(true))
          : (
            <FolderBody
              filter={current.folder_id}
              order={order}
              search={search}
              editing={editing}
              setEditing={setEditing}
              setSheet={setSheet}
            />
          )}

      <Dropdown
        visible={menu}
        onClose={() => setMenu(false)}
        anchor={menuAnchor}
        title={friend ? name : t('together')}
        items={[
          { label: prefs.showDone ? t('hideDone') : t('showDone'), onPress: () => setPrefs({ showDone: !prefs.showDone }) },
          { label: t('friendsAdd'), onPress: () => setAdding(true) },
          ...(friend ? [{ label: t('shareFolderWithFriend'), onPress: () => setSharing(true) }] : []),
          ...(current?.mine ? [{ label: t('manageSharing'), onPress: () => router.push(`/share/${current.folder_id}`) }] : []),
          ...(friend ? [{ label: t('removeFriend'), onPress: () => setConfirmRemove(true), danger: true }] : []),
        ]}
      />
      <ItemSheets state={sheet} setState={setSheet} />
      <AddFriendSheet visible={adding} onClose={() => setAdding(false)} />
      <ShareWithFriendSheet
        friend={sharing ? friend : null}
        onClose={() => setSharing(false)}
        onShared={(id) => friend && setFolderByFriend((m) => ({ ...m, [friend.id]: id }))}
      />
      <ConfirmDialog
        visible={confirmRemove && !!friend}
        title={t('removeFriend')}
        body={t('removeFriendBody')}
        confirmLabel={t('removeFriend')}
        danger
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => {
          if (!friend) return;
          try {
            await friends.remove(friend.id);
            setFriendId(null);
            showToast({ message: t('friendRemoved') });
          } catch {
            showToast({ message: t('err_network') });
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  add: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  // 받은 친구 요청이 있으면 + 오른쪽 위 점(시안)
  dot: { position: 'absolute', top: 0, right: 0, width: 8, height: 8, borderRadius: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  emptyBtn: { marginTop: 22, height: 46, borderRadius: 23, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
});
