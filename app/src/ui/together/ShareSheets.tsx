import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { errorText } from '../../i18n';
import { useApp } from '../../state/AppContext';
import { personName, useFriends, type Friend } from '../../state/friends';
import { liveFolders } from '../home/model';
import { CheckIcon, FolderIcon, PlusIcon } from '../Icons';
import { Segmented, Sheet, SheetButton, SheetTitle } from '../primitives';
import { inputColors } from '../theme';

type Role = 'view' | 'edit';

/** 이름 목록: 민지·수빈 */
export const joinNames = (people: Friend[]) => people.map(personName).join('·');

/** 친구 여러 명 고르기(고른 친구는 진하고 굵게 + 체크). already: 이미 공유한 친구(고를 수 없게 체크된 채로) */
function FriendPicker({ list, picked, already, onToggle }: { list: Friend[]; picked: Set<string>; already?: Set<string>; onToggle: (id: string) => void }) {
  const { theme } = useApp();
  return (
    <>
      {list.map((f) => {
        const done = already?.has(f.id) ?? false;
        const on = done || picked.has(f.id);
        return (
          <SheetButton
            key={f.id}
            // 동명이인은 이메일로 구분
            label={list.some((o) => o.id !== f.id && personName(o) === personName(f)) ? `${personName(f)} · ${f.email}` : personName(f)}
            selected={on}
            disabled={done}
            icon={<View style={styles.check}>{on ? <CheckIcon color={theme.accent} size={18} /> : null}</View>}
            onPress={() => onToggle(f.id)}
          />
        );
      })}
    </>
  );
}

/** 권한(기본 '보기만')과 누가 접근하게 되는지 */
function RoleAndSummary({ role, setRole, people }: { role: Role; setRole: (r: Role) => void; people: Friend[] }) {
  const { theme, t } = useApp();
  return (
    <View style={styles.pad}>
      <Text style={[theme.font(13, { color: theme.muted }), styles.label]}>{t('newSharedRole')}</Text>
      <Segmented
        options={[
          { value: 'view', label: t('viewOnly') },
          { value: 'edit', label: t('editTogether') },
        ]}
        value={role}
        onChange={setRole}
      />
      <Text style={theme.kfont(14.5, { color: people.length ? theme.text : theme.muted, marginTop: 14, lineHeight: 21 })}>
        {people.length ? t(role === 'edit' ? 'summaryEdit' : 'summaryView', { names: joinNames(people) }) : t('pickFriend')}
      </Text>
    </View>
  );
}

function Primary({ label, onPress, disabled, busy }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  const { theme } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={[styles.primary, { backgroundColor: theme.accent, opacity: disabled ? 0.45 : 1 }]}
    >
      {busy ? <ActivityIndicator color={theme.onAccent} /> : <Text style={theme.kfont(15.5, { color: theme.onAccent, fontWeight: '700' })}>{label}</Text>}
    </Pressable>
  );
}

/**
 * 친구에게 공유: 내 폴더 하나를 고른 친구들에게(이미 친구라 다시 수락을 묻지 않는다) '보기만'(기본) 또는 '함께 편집'으로.
 * folderId가 없으면 먼저 공유할 내 폴더를 고른다(함께 탭의 빈 화면 '폴더 공유'): 공유받은 폴더와 기본 폴더는 고를 수 없고, '새 공유 폴더'로도 갈 수 있다.
 */
export function FriendShareSheet({
  open,
  folderId: initialFolder,
  preselect,
  onClose,
  onNew,
  onShared,
}: {
  open: boolean;
  folderId?: string | null;
  /** 미리 고른 친구(함께 탭에서 지금 고른 친구) */
  preselect?: string | null;
  onClose: () => void;
  /** '새 공유 폴더'를 눌렀다(폴더 고르기 단계에서) */
  onNew?: () => void;
  onShared?: (folderId: string) => void;
}) {
  const { t, theme, snap, showToast } = useApp();
  const friends = useFriends();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [role, setRole] = useState<Role>('view');
  const [busy, setBusy] = useState(false);
  // 열릴 때마다 처음 상태로(그리는 중에 맞춘다)
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFolderId(initialFolder ?? null);
      setPicked(new Set(preselect ? [preselect] : []));
      setRole('view');
    }
  }
  const list = friends.data.friends;
  const mine = useMemo(() => {
    const foreign = new Set(snap.shared.map((s) => s.folder_id));
    return liveFolders(snap.folders).filter((f) => !foreign.has(f.id));
  }, [snap.folders, snap.shared]);
  const folder = mine.find((f) => f.id === folderId);
  // 이 폴더를 이미 함께 쓰는 친구
  const already = useMemo(() => new Set(list.filter((f) => f.folders.some((ff) => ff.folder_id === folderId && ff.mine)).map((f) => f.id)), [list, folderId]);
  const people = list.filter((f) => picked.has(f.id) && !already.has(f.id));

  const share = async () => {
    if (!folder || !people.length || busy) return;
    setBusy(true);
    try {
      await friends.shareFolder(folder.id, people.map((p) => p.id), role);
      showToast({ message: t('sharedWithFriends', { names: joinNames(people) }) });
      onShared?.(folder.id);
      onClose();
    } catch (e) {
      showToast({ message: errorText(e, t) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={open} onClose={onClose} dialog>
      {!folder ? (
        <>
          <SheetTitle
            title={preselect ? t('shareFolderChooser', { name: personName(list.find((f) => f.id === preselect) ?? { id: '', email: '', name: '' }) }) : t('shareToFriend')}
            subtitle={mine.length ? undefined : t('noFolderToShare')}
          />
          {mine.map((f) => (
            <SheetButton key={f.id} label={f.name} icon={<FolderIcon color={theme.muted} size={20} />} onPress={() => setFolderId(f.id)} />
          ))}
          {onNew ? <SheetButton label={t('newShared')} icon={<PlusIcon color={theme.accent} size={20} strokeWidth={1.8} />} onPress={onNew} /> : null}
        </>
      ) : (
        <>
          <SheetTitle title={t('shareToFriend')} subtitle={folder.name} />
          <Text style={[theme.kfont(14, { color: theme.muted, lineHeight: 20 }), styles.hint]}>{t('shareToFriendHint')}</Text>
          {list.length ? (
            <FriendPicker
              list={list}
              picked={picked}
              already={already}
              onToggle={(id) =>
                setPicked((s) => {
                  const n = new Set(s);
                  if (n.has(id)) n.delete(id);
                  else n.add(id);
                  return n;
                })
              }
            />
          ) : (
            <Text style={[theme.kfont(15, { color: theme.muted }), styles.hint]}>{t('noFriendsToShare')}</Text>
          )}
          <RoleAndSummary role={role} setRole={setRole} people={people} />
          <View style={styles.pad}>
            <Primary label={t('share')} onPress={() => void share()} disabled={!people.length} busy={busy} />
          </View>
        </>
      )}
      <View style={{ height: 10 }} />
    </Sheet>
  );
}

/** 새 공유 폴더: 이름 + 함께할 친구(지금 고른 친구가 미리 골라져 있다) + 권한(기본 보기만). 만들기 전에 누가 접근하게 되는지 보인다 */
export function NewSharedFolderSheet({
  open,
  preselect,
  onClose,
  onCreated,
}: {
  open: boolean;
  preselect?: string | null;
  onClose: () => void;
  onCreated: (folderId: string) => void;
}) {
  const { t, theme, showToast } = useApp();
  const friends = useFriends();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [role, setRole] = useState<Role>('view');
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName('');
      setPicked(new Set(preselect ? [preselect] : []));
      setRole('view');
    }
  }
  const list = friends.data.friends;
  const people = list.filter((f) => picked.has(f.id));
  const ok = name.trim().length > 0 && people.length > 0;
  const create = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      const id = await friends.createShared(name.trim(), people.map((p) => p.id), role);
      showToast({ message: t('sharedWithFriends', { names: joinNames(people) }) });
      onCreated(id);
      onClose();
    } catch (e) {
      // 폴더는 내 기기에 만들어졌을 수 있다(공유만 실패): 그대로 알리고 홈에 남은 폴더에서 다시 공유할 수 있다
      showToast({ message: errorText(e, t) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={open} onClose={onClose} dialog>
      <SheetTitle title={t('newShared')} />
      <View style={styles.pad}>
        <TextInput
          value={name}
          onChangeText={setName}
          {...inputColors(theme)}
          placeholder={t('newSharedName')}
          placeholderTextColor={theme.muted}
          maxLength={40}
          accessibilityLabel={t('newSharedName')}
          style={[
            styles.field,
            theme.font(16, { color: theme.text }),
            { backgroundColor: theme.dark ? '#000' : '#F1F2F4' },
            Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
          ]}
        />
        <Text style={[theme.font(13, { color: theme.muted }), styles.label, { marginTop: 16 }]}>{t('newSharedWith')}</Text>
      </View>
      {list.length ? (
        <FriendPicker
          list={list}
          picked={picked}
          onToggle={(id) =>
            setPicked((s) => {
              const n = new Set(s);
              if (n.has(id)) n.delete(id);
              else n.add(id);
              return n;
            })
          }
        />
      ) : (
        <Text style={[theme.kfont(15, { color: theme.muted }), styles.hint]}>{t('noFriendsToShare')}</Text>
      )}
      <RoleAndSummary role={role} setRole={setRole} people={people} />
      <View style={styles.pad}>
        <Primary label={t('newSharedCreate')} onPress={() => void create()} disabled={!ok} busy={busy} />
      </View>
      <View style={{ height: 10 }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 22, paddingTop: 6 },
  hint: { paddingHorizontal: 22, paddingBottom: 6 },
  label: { marginBottom: 8 },
  check: { width: 20, alignItems: 'center' },
  field: { height: 46, borderRadius: 12, paddingHorizontal: 14 },
  primary: { marginTop: 16, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
