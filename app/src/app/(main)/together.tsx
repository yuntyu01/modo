import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';

import { errorText } from '../../i18n';
import { useApp, useSyncStatus } from '../../state/AppContext';
import { personName, useFriends, type Friend, type FriendFolder } from '../../state/friends';
import { deepAccent } from '../../ui/color';
import { Dropdown } from '../../ui/Dropdown';
import { formatDate, localDate } from '../../ui/format';
import { ItemSheets, type SheetState } from '../../ui/ItemSheets';
import type { Editing } from '../../ui/home/Cards';
import { FolderBody } from '../../ui/home/FolderBody';
import { HomeHeader, SearchBar } from '../../ui/home/Header';
import { PlusIcon } from '../../ui/Icons';
import { useBottomInset, useWide } from '../../ui/layout';
import { ConfirmDialog, Sheet, SheetButton, SheetTitle } from '../../ui/primitives';
import { AddFriendSheet } from '../../ui/together/AddFriendSheet';
import { CopySheet, type CopySource } from '../../ui/together/CopySheet';
import { FriendShareSheet, NewSharedFolderSheet } from '../../ui/together/ShareSheets';
import { TabRow } from '../../ui/together/TabRow';

/** 다시 들어왔을 때 되살리는 고른 친구·친구별 마지막 폴더(이 기기, 계정마다) */
type Picks = { friend: string | null; folders: Record<string, string> };
const NO_PICKS: Picks = { friend: null, folders: {} };

/**
 * 함께(시안): 로고·도구 → 친구 이름 줄(+ 친구 추가, 받은 요청이 있으면 점) → 그 친구와 함께 쓰는 폴더 줄('보기만'·'함께 편집') →
 * 그 폴더의 메모·할 일·입력창(홈과 같은 FolderBody, 같은 폴더 데이터를 그대로 쓴다. 복제하지 않는다).
 * 친구 관계와 폴더 공유 권한은 따로다:
 * - 친구가 되어도 아무것도 보이지 않는다. 폴더 줄에는 내가 지금 접근할 수 있는 폴더 중 그 친구와 함께 쓰는 것만
 *   (친구가 공유한 폴더, 내가 친구에게 공유한 폴더, 다른 사람 폴더에 둘 다 참여 중인 폴더. 서버가 고른다).
 * - 쓰기는 공유 권한대로(보기만이면 입력창이 없고 체크도 안 된다, 서버도 다시 확인한다).
 * - 친구를 삭제해도 공유는 그대로다(⋯ > 공유 관리, 홈 표시로 계속 들어갈 수 있다).
 */
export default function Together() {
  const { snap, prefs, setPrefs, t, theme, showToast, sync, repo, account, lang } = useApp();
  const friends = useFriends();
  const status = useSyncStatus();
  const [picks, setPicks] = useState<Picks | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menu, setMenu] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<View | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copying, setCopying] = useState<CopySource | null>(null);
  const [managing, setManaging] = useState<Friend | null>(null);
  const [confirm, setConfirm] = useState<'removeFriend' | 'leave' | null>(null);
  const [retrying, setRetrying] = useState(false);
  const { compact, width } = useWide();
  const navInset = useBottomInset();

  // 고른 친구·폴더를 되살린다(계정마다). 처음 읽기 전에는 저장하지 않는다
  const picksKey = `together_ui:${account?.id ?? ''}`;
  useEffect(() => {
    let alive = true;
    void repo.getKv<Picks>(picksKey, NO_PICKS).then((p) => alive && setPicks(p));
    return () => {
      alive = false;
    };
  }, [repo, picksKey]);
  const pick = (next: Partial<Picks>) => {
    const p = { ...(picks ?? NO_PICKS), ...next };
    setPicks(p);
    void repo.write(() => repo.setKv(picksKey, p));
  };

  const list = friends.data.friends;
  const friend = list.find((f) => f.id === picks?.friend) ?? list[0] ?? null;
  const folderIndex = useMemo(() => new Map(snap.folders.filter((f) => !f.deleted_at).map((f, i) => [f.id, i])), [snap.folders]);
  // 이 기기에 있는(동기화된) 폴더만, 홈 폴더 줄과 같은 순서로. 방금 공유받아 아직 없는 폴더는 한 번 동기화해서 받는다
  const shared = useMemo(
    () => (friend ? friend.folders.filter((ff) => folderIndex.has(ff.folder_id)).sort((a, b) => folderIndex.get(a.folder_id)! - folderIndex.get(b.folder_id)!) : []),
    [friend, folderIndex],
  );
  const missing = friend ? friend.folders.filter((ff) => !folderIndex.has(ff.folder_id)).map((ff) => ff.folder_id).join(',') : '';
  const synced = useRef('');
  useEffect(() => {
    if (!missing || synced.current === missing) return;
    synced.current = missing;
    void sync.syncNow();
  }, [missing, sync]);

  const current: FriendFolder | null = (friend && shared.find((ff) => ff.folder_id === picks?.folders[friend.id])) ?? shared[0] ?? null;
  const order = useMemo(() => shared.map((ff) => ff.folder_id), [shared]);
  const folderName = (id: string) => snap.folders.find((f) => f.id === id)?.name ?? '';
  const name = friend ? personName(friend) : '';

  // 보고 있던 폴더가 지워졌거나 공유가 끊기면 다른 폴더로 옮기고 짧게 알린다(친구를 바꾼 것과는 구분)
  const shown = useRef<{ friend: string | null; folder: string | null }>({ friend: null, folder: null });
  useEffect(() => {
    const prev = shown.current;
    if (friend && prev.friend === friend.id && prev.folder && !shared.some((ff) => ff.folder_id === prev.folder)) showToast({ message: t('folderGone') });
    shown.current = { friend: friend?.id ?? null, folder: current?.folder_id ?? null };
  }, [friend, shared, current, showToast, t]);

  const select = (next: Partial<Picks>) => {
    // 바꾸는 즉시 이전 사람·폴더의 편집과 찾기를 닫는다(이전 내용이 새 선택 아래 남지 않게)
    setEditing(null);
    setSearch(null);
    pick(next);
  };

  // 오른쪽 작은 권한 표시: 내 폴더면 친구에게 준 권한, 아니면 내 권한
  const roleLabel = current ? ((current.mine ? current.friend_role : current.role) === 'edit' ? t('editTogether') : t('viewOnly')) : '';
  const homeShown = current ? snap.shared.find((s) => s.folder_id === current.folder_id)?.home !== false : true;
  const narrow = width < 340;

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      showToast({ message: errorText(e, t) });
    }
  };

  const addButton = (
    <Pressable accessibilityLabel={t('friendsAdd')} accessibilityRole="button" onPress={() => setAdding(true)} hitSlop={12} style={styles.add}>
      <PlusIcon color={theme.tab} size={22 * theme.zoom} strokeWidth={1.7} />
      {/* 처리하지 않은 받은 요청이 있는 동안만(요청 화면을 봤다고 없애지 않는다) */}
      {friends.data.incoming.length ? <View style={[styles.dot, { backgroundColor: theme.accent }]} /> : null}
    </Pressable>
  );

  // 빈 화면: 큰 그림 없이 한 줄 + 버튼 하나
  const empty = (title: string, action?: { label: string; run: () => void }, note?: string) => (
    <View style={[styles.empty, { paddingBottom: navInset + 40 }]}>
      <Text style={theme.kfont(16.5, { color: theme.text, textAlign: 'center', lineHeight: 24 })}>{title}</Text>
      {note ? <Text style={theme.kfont(14, { color: theme.muted, textAlign: 'center', marginTop: 8 })}>{note}</Text> : null}
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.run} style={[styles.emptyBtn, { backgroundColor: deepAccent(theme.accent) }]}>
          <Text style={theme.kfont(15.5, { color: '#FFFFFF', fontWeight: '700' })}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
  const retry = async () => {
    setRetrying(true);
    try {
      await friends.refresh();
    } finally {
      setRetrying(false);
    }
  };

  let body;
  if (!friends.loaded || !picks) {
    // 아직 한 번도 받지 못했다: 연결이 안 되면 다시 시도, 아니면 받는 중(고른 친구를 되살리기 전에도 잠깐)
    body =
      // (동기화는 끝났는데 친구 목록이 없으면: 아직 이 기능이 없는 서버)
      !friends.loaded && (status.state === 'offline' || status.state === 'error' || (status.state === 'idle' && !!status.lastSyncAt)) && !retrying
        ? empty(t('friendsLoadFailed'), { label: t('retry'), run: () => void retry() }, status.state === 'offline' ? t('err_network') : undefined)
        : (
          <View style={[styles.empty, { paddingBottom: navInset + 40 }]}>
            <ActivityIndicator color={theme.muted} />
          </View>
        );
  } else if (!friend) {
    body = empty(t('friendsEmpty'), { label: t('friendsAdd'), run: () => setAdding(true) }, t('friendsNote'));
  } else if (!current) {
    body = empty(t('friendNoFolders'), { label: t('shareFolderBtn'), run: () => setSharing(true) });
  } else {
    body = (
      <FolderBody
        key={friend.id}
        filter={current.folder_id}
        order={order}
        search={search}
        editing={editing}
        setEditing={setEditing}
        setSheet={setSheet}
      />
    );
  }

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
        level="friend"
        items={list.map((f) => ({ key: f.id, label: personName(f) }))}
        selected={picks ? (friend?.id ?? null) : null}
        onSelect={(id) => select({ friend: id })}
        onLongPress={(id) => setManaging(list.find((f) => f.id === id) ?? null)}
        right={addButton}
      />
      {picks && friend && shared.length ? (
        <TabRow
          level="folder"
          items={shared.map((ff) => ({ key: ff.folder_id, label: folderName(ff.folder_id) }))}
          selected={current?.folder_id ?? null}
          onSelect={(id) => select({ folders: { ...(picks?.folders ?? {}), [friend.id]: id } })}
          right={
            narrow ? undefined : (
              <Text numberOfLines={1} style={theme.kfont((compact ? 12.5 : 13) * theme.zoom, { color: theme.subtle })}>
                {roleLabel}
              </Text>
            )
          }
        />
      ) : null}

      {body}

      <Dropdown
        visible={menu}
        onClose={() => setMenu(false)}
        anchor={menuAnchor}
        title={current ? folderName(current.folder_id) : friend ? name : t('together')}
        items={[
          { label: prefs.showDone ? t('hideDone') : t('showDone'), onPress: () => setPrefs({ showDone: !prefs.showDone }) },
          // 홈에 표시: 같은 공유 폴더를 내 홈에서도(내 설정만, 원본·권한 그대로). 내 폴더는 원래 홈에 있다
          current && !current.mine
            ? {
                label: homeShown ? t('hideFromHome') : t('showOnHome'),
                onPress: () =>
                  void act(async () => {
                    await friends.setHome(current.folder_id, !homeShown);
                    showToast({ message: homeShown ? t('hiddenFromHome') : t('shownOnHome') });
                  }),
              }
            : null,
          // 내 폴더에 복사: 새 id의 독립된 복사본(원본과 동기화되지 않는다)
          current && !current.mine ? { label: t('copyToMine'), onPress: () => setCopying({ folderId: current.folder_id }) } : null,
          current ? { label: t('manageSharing'), onPress: () => router.push(`/share/${current.folder_id}`) } : null,
          { label: t('newShared'), onPress: () => setCreating(true) },
          friend ? { label: t('friendManage'), onPress: () => setManaging(friend) } : null,
          current && !current.mine ? { label: t('leaveFolder'), onPress: () => setConfirm('leave'), danger: true } : null,
          current?.mine ? { label: t('deleteFolderAll'), onPress: () => setSheet({ type: 'deleteFolder', id: current.folder_id }), danger: true } : null,
        ]}
      />
      <ItemSheets state={sheet} setState={setSheet} />
      <AddFriendSheet visible={adding} onClose={() => setAdding(false)} />
      <FriendShareSheet
        open={sharing}
        preselect={friend?.id}
        onClose={() => setSharing(false)}
        onNew={() => {
          setSharing(false);
          setCreating(true);
        }}
        onShared={(id) => friend && pick({ folders: { ...(picks?.folders ?? {}), [friend.id]: id } })}
      />
      <NewSharedFolderSheet
        open={creating}
        preselect={friend?.id}
        onClose={() => setCreating(false)}
        onCreated={(id) => friend && pick({ folders: { ...(picks?.folders ?? {}), [friend.id]: id } })}
      />
      <CopySheet source={copying} onClose={() => setCopying(null)} />

      {/* 친구 관리(이름 길게 누르기·PC 오른쪽 클릭): 동명이인은 이메일로 구분한다 */}
      <Sheet visible={!!managing && !confirm} onClose={() => setManaging(null)} dialog>
        {managing ? (
          <>
            <SheetTitle title={t('friendManage')} subtitle={personName(managing)} />
            <View style={styles.manageInfo}>
              <Text style={theme.font(14, { color: theme.muted })}>{managing.email}</Text>
              <Text style={theme.kfont(14, { color: theme.muted, marginTop: 4 })}>
                {t('friendSince', { date: formatDate(localDate(new Date(managing.since)), lang) })}
              </Text>
            </View>
            <SheetButton
              label={t('shareFolderBtn')}
              onPress={() => {
                select({ friend: managing.id });
                setManaging(null);
                setSharing(true);
              }}
            />
            <SheetButton label={t('removeFriend')} danger onPress={() => setConfirm('removeFriend')} />
            <View style={{ height: 10 }} />
          </>
        ) : null}
      </Sheet>
      <ConfirmDialog
        visible={confirm === 'removeFriend' && !!managing}
        title={t('removeFriend')}
        body={t('removeFriendBody')}
        confirmLabel={t('removeFriend')}
        danger
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          void act(async () => {
            if (!managing) return;
            const who = managing;
            setManaging(null);
            await friends.remove(who.id);
            showToast({ message: t('friendRemoved') });
          })
        }
      />
      <ConfirmDialog
        visible={confirm === 'leave' && !!current}
        title={t('leaveFolderQ', { name: current ? folderName(current.folder_id) : '' })}
        body={t('leaveFolderBody')}
        confirmLabel={t('leaveFolder')}
        danger
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          void act(async () => {
            if (!current) return;
            await friends.leave(current.folder_id);
            showToast({ message: t('leftFolder') });
          })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  add: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  // 받은 친구 요청이 있으면 + 오른쪽 위 점(시안)
  dot: { position: 'absolute', top: 0, right: 0, width: 8, height: 8, borderRadius: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  emptyBtn: { marginTop: 18, height: 44, borderRadius: 22, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  manageInfo: { paddingHorizontal: 22, paddingBottom: 10 },
});
