import { router } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { toPlain } from '../core/rich';
import type { Folder, Paragraph, Todo } from '../core/types';
import { native } from '../native/bridge';
import { errorText } from '../i18n';
import { useApp, useUi } from '../state/AppContext';
import { useFriends } from '../state/friends';
import { ruleOf } from '../core/repeat';
import { describeRepeat, formatDate, formatDateTime, localDate, parseLocalDate } from './format';
import { Dropdown, type MenuItem } from './Dropdown';
import { BellIcon, CalendarIcon, ChevronIcon, EditIcon, FolderIcon, InfoIcon, PeopleIcon, RepeatIcon, ShareIcon, TrashIcon } from './Icons';
import { MonthGrid } from './MonthGrid';
import { ConfirmDialog, InfoRow, PromptDialog, Sheet, SheetButton, SheetTitle } from './primitives';
import { RepeatSheet } from './RepeatSheet';
import { folderAsText, shareText } from './share';
import { CopySheet } from './together/CopySheet';
import { FriendShareSheet, joinNames } from './together/ShareSheets';
import type { MenuPoint } from './webLongPress';

/** at: PC에서 오른쪽 클릭·꾹 눌러 열었으면 그 자리(시트 대신 그 자리에 작은 메뉴, webLongPress.takeMenuPoint) */
export type SheetState =
  | { type: 'todo'; id: string; at?: MenuPoint }
  | { type: 'paragraph'; id: string; at?: MenuPoint }
  | { type: 'folderPick'; entity: 'todo' | 'paragraph'; id: string }
  | { type: 'date'; id: string }
  | { type: 'remind'; id: string }
  | { type: 'repeat'; id: string }
  | { type: 'folder'; id: string; at?: MenuPoint }
  | { type: 'rename'; id: string }
  | { type: 'deleteFolder'; id: string }
  | { type: 'newFolder' }
  /** 내 폴더를 친구에게 공유(친구 고르기 + 보기만/함께 편집) */
  | { type: 'shareFriend'; id: string }
  /** 공유받은 폴더(또는 그 안의 할 일)를 내 폴더에 복사 */
  | { type: 'copy'; folderId: string; todoIds?: string[] }
  /** 공유 폴더 나가기(참여자) */
  | { type: 'leave'; id: string }
  | null;

/** 시트가 아니라 누른 자리에 작은 메뉴로 열린 상태인지(미니창은 이때 창을 키우지 않는다) */
export const isPointMenu = (s: SheetState) => !!s && 'at' in s && !!s.at;

type Icon = (p: { color: string; size?: number }) => ReactNode;

export function ItemSheets({ state, setState }: { state: SheetState; setState: (s: SheetState) => void }) {
  const app = useApp();
  const { snap, repo, t, theme, showToast, canWrite, setFilter, filter, lang, serverApi, account } = app;
  const friends = useFriends();
  const close = () => setState(null);
  const foreign = (folderId: string | null) => !!folderId && snap.shared.some((s) => s.folder_id === folderId);
  const folderName = (id: string | null) => (id ? (snap.folders.find((f) => f.id === id)?.name ?? t('baseFolder')) : t('baseFolder'));

  const trashWithUndo = async (entity: 'todo' | 'paragraph', id: string) => {
    close();
    await repo.trash(entity, [id]);
    showToast({ message: t('deleted'), action: { label: t('undo'), run: () => repo.restore(entity, [id]) } });
  };
  const doShare = async (text: string) => {
    close();
    if ((await shareText(text)) === 'copied') showToast({ message: t('copied') });
  };

  const todo = state && 'id' in state ? snap.todos.find((x) => x.id === state.id) : undefined;
  const para = state && 'id' in state ? snap.paragraphs.find((x) => x.id === state.id) : undefined;
  const folder = state && 'id' in state ? snap.folders.find((x) => x.id === state.id) : undefined;
  const sharedWith = folder ? friends.data.friends.filter((f) => f.folders.some((ff) => ff.folder_id === folder.id && ff.mine)) : [];
  // 복사 시트에 넘기는 것은 열려 있는 동안 같은 객체(시트가 열릴 때마다 처음 상태로 맞춘다)
  const copyKey = state?.type === 'copy' ? `${state.folderId}|${state.todoIds?.join(',') ?? ''}` : '';
  const copySource = useMemo(() => {
    if (!copyKey) return null;
    const [folderId, ids] = copyKey.split('|');
    return { folderId, todoIds: ids ? ids.split(',') : undefined };
  }, [copyKey]);

  // 항목에서 할 수 있는 것. 휴대폰 시트의 단추와 PC 오른쪽 클릭 메뉴가 같은 목록을 쓴다(size = 아이콘 크기)
  const item = (label: string, I: Icon, size: number, onPress: () => void, danger?: boolean): MenuItem => ({
    label,
    icon: <I color={danger ? theme.danger : theme.text} size={size} />,
    onPress,
    danger,
  });
  const todoItems = (x: Todo, size: number): MenuItem[] => {
    const share = item(t('share'), ShareIcon, size, () => doShare(x.text));
    // 보기만 공유된 할 일도 내 폴더로 독립 복사할 수 있다
    const copy = foreign(x.folder_id) ? item(t('copyToMine'), FolderIcon, size, () => setState({ type: 'copy', folderId: x.folder_id ?? '', todoIds: [x.id] })) : null;
    if (!canWrite(x.folder_id)) return copy ? [share, copy] : [share];
    return [
      item(t('classify'), FolderIcon, size, () => setState({ type: 'folderPick', entity: 'todo', id: x.id })),
      item(t('setDate'), CalendarIcon, size, () => setState({ type: 'date', id: x.id })),
      item(t('setReminder'), BellIcon, size, () => setState({ type: 'remind', id: x.id })),
      item(t('repeat'), RepeatIcon, size, () => setState({ type: 'repeat', id: x.id })),
      share,
      ...(copy ? [copy] : []),
      item(t('delete'), TrashIcon, size, () => trashWithUndo('todo', x.id), true),
    ];
  };
  const paragraphItems = (p: Paragraph, size: number): MenuItem[] => {
    const share = item(t('share'), ShareIcon, size, () => doShare(p.text));
    if (!canWrite(p.folder_id)) return [share];
    return [
      item(t('classify'), FolderIcon, size, () => setState({ type: 'folderPick', entity: 'paragraph', id: p.id })),
      share,
      item(t('delete'), TrashIcon, size, () => trashWithUndo('paragraph', p.id), true),
    ];
  };
  const folderItems = (f: Folder, size: number): MenuItem[] => {
    const shared = snap.shared.find((x) => x.folder_id === f.id);
    // 친구·계정 공유는 서버가 있어야 해서 서버에 닿고 로그인했을 때만
    const online = !!serverApi && !!account;
    const list: (MenuItem | false)[] = [
      !shared && item(t('rename'), EditIcon, size, () => setState({ type: 'rename', id: f.id })),
      item(t('shareText'), ShareIcon, size, () =>
        doShare(
          folderAsText(
            f.name,
            snap.paragraphs.filter((p) => p.folder_id === f.id && !p.deleted_at),
            snap.todos.filter((x) => x.folder_id === f.id && !x.deleted_at),
          ),
        ),
      ),
      !shared && online && item(t('shareToFriend'), PeopleIcon, size, () => setState({ type: 'shareFriend', id: f.id })),
      online &&
        item(shared ? t('manageSharing') : t('shareAccount'), PeopleIcon, size, () => {
          close();
          router.push({ pathname: '/share/[id]', params: { id: f.id } });
        }),
      !!shared &&
        online &&
        item(shared.home === false ? t('showOnHome') : t('hideFromHome'), FolderIcon, size, () => {
          const home = shared.home === false;
          close();
          friends
            .setHome(f.id, home)
            .then(() => showToast({ message: home ? t('shownOnHome') : t('hiddenFromHome') }))
            .catch((e: unknown) => showToast({ message: errorText(e, t) }));
        }),
      !!shared && item(t('copyToMine'), FolderIcon, size, () => setState({ type: 'copy', folderId: f.id })),
      !shared && item(t('delete'), TrashIcon, size, () => setState({ type: 'deleteFolder', id: f.id }), true),
      !!shared && online && item(t('leaveFolder'), TrashIcon, size, () => setState({ type: 'leave', id: f.id }), true),
    ];
    return list.filter((x): x is MenuItem => !!x);
  };
  const buttons = (items: MenuItem[]) =>
    items.map((it) => <SheetButton key={it.label} icon={it.icon} label={it.label} danger={it.danger} onPress={it.onPress} />);

  // PC 오른쪽 클릭: 같은 항목을 누른 자리에(만든 때·고친 때 같은 정보는 '정보'로 여는 시트에서). 지우기 같은 빨간 항목은 맨 아래
  const at = state && 'at' in state ? state.at : undefined;
  const withInfo = (items: MenuItem[], info: MenuItem) => {
    const i = items.findIndex((x) => x.danger);
    return i < 0 ? [...items, info] : [...items.slice(0, i), info, ...items.slice(i)];
  };
  const menu = !at
    ? null
    : state?.type === 'todo' && todo
      ? { title: toPlain(todo.text), items: withInfo(todoItems(todo, 17), item(t('details'), InfoIcon, 17, () => setState({ type: 'todo', id: todo.id }))) }
      : state?.type === 'paragraph' && para
        ? { title: toPlain(para.text), items: withInfo(paragraphItems(para, 17), item(t('details'), InfoIcon, 17, () => setState({ type: 'paragraph', id: para.id }))) }
        : state?.type === 'folder' && folder
          ? { title: folder.name, items: folderItems(folder, 17) }
          : null;

  return (
    <>
      <Dropdown visible={!!menu} onClose={close} point={at} title={menu?.title} items={menu?.items ?? []} />

      <Sheet visible={state?.type === 'todo' && !!todo && !at} onClose={close}>
        {todo ? (
          <>
            <SheetTitle title={t('todoInfo')} subtitle={toPlain(todo.text)} />
            <View style={styles.info}>
              {/* 완료한 할 일은 '언제 했는지'를 맨 위에 */}
              {todo.done_at ? <InfoRow label={t('doneAt')} value={formatDateTime(todo.done_at, lang)} /> : null}
              <InfoRow label={t('createdAt')} value={formatDateTime(todo.created_at, lang)} />
              <InfoRow label={t('updatedAt')} value={formatDateTime(todo.updated_at, lang)} />
              <InfoRow label={t('folder')} value={folderName(todo.folder_id)} />
              {todo.due_date ? <InfoRow label={t('dueDate')} value={formatDate(todo.due_date, lang)} /> : null}
              {ruleOf(todo) ? <InfoRow label={t('repeat')} value={describeRepeat(ruleOf(todo)!, lang, todo.due_date)} /> : null}
              {todo.remind_at ? <InfoRow label={t('remindAt')} value={formatDateTime(todo.remind_at, lang)} /> : null}
            </View>
            {buttons(todoItems(todo, 20))}
          </>
        ) : null}
      </Sheet>

      <Sheet visible={state?.type === 'paragraph' && !!para && !at} onClose={close}>
        {para ? (
          <>
            <SheetTitle title={t('paragraphInfo')} subtitle={toPlain(para.text) || ' '} />
            <View style={styles.info}>
              <InfoRow label={t('createdAt')} value={formatDateTime(para.created_at, lang)} />
              <InfoRow label={t('updatedAt')} value={formatDateTime(para.updated_at, lang)} />
              <InfoRow label={t('folder')} value={folderName(para.folder_id)} />
            </View>
            {buttons(paragraphItems(para, 20))}
          </>
        ) : null}
      </Sheet>

      <Sheet visible={state?.type === 'folderPick'} onClose={close}>
        {state?.type === 'folderPick' ? (
          <FolderPick
            current={(state.entity === 'todo' ? todo?.folder_id : para?.folder_id) ?? null}
            folders={snap.folders.filter((f) => !f.deleted_at && canWrite(f.id))}
            onPick={async (fid) => {
              close();
              await repo.setFolder(state.entity, state.id, fid);
            }}
          />
        ) : null}
      </Sheet>

      <Sheet visible={state?.type === 'date' && !!todo} onClose={close}>
        {todo ? (
          <DatePick
            initial={todo.due_date}
            onPick={async (d) => {
              close();
              await repo.setDue(todo.id, d);
            }}
          />
        ) : null}
      </Sheet>

      <Sheet visible={state?.type === 'remind' && !!todo} onClose={close}>
        {todo ? (
          <ReminderPick
            initial={todo.remind_at}
            due={todo.due_date}
            onPick={async (at) => {
              close();
              await repo.setRemind(todo.id, at);
            }}
          />
        ) : null}
      </Sheet>

      <RepeatSheet todo={state?.type === 'repeat' ? todo : undefined} onClose={close} />

      <Sheet visible={state?.type === 'folder' && !!folder && !at} onClose={close}>
        {folder ? (
          <>
            <SheetTitle title={t('folder')} subtitle={folder.name} />
            {buttons(folderItems(folder, 20))}
          </>
        ) : null}
      </Sheet>

      <FriendShareSheet open={state?.type === 'shareFriend'} folderId={state?.type === 'shareFriend' ? state.id : null} onClose={close} />
      <CopySheet source={copySource} onClose={close} />
      <ConfirmDialog
        visible={state?.type === 'leave' && !!folder}
        title={t('leaveFolderQ', { name: folder?.name ?? '' })}
        body={t('leaveFolderBody')}
        confirmLabel={t('leaveFolder')}
        danger
        onConfirm={async () => {
          if (!folder) return;
          try {
            await friends.leave(folder.id);
            if (filter === folder.id) setFilter(null);
            showToast({ message: t('leftFolder') });
          } catch (e) {
            showToast({ message: errorText(e, t) });
          }
        }}
        onClose={close}
      />

      <PromptDialog
        visible={state?.type === 'newFolder'}
        title={t('newFolder')}
        placeholder={t('folderName')}
        confirmLabel={t('add')}
        onConfirm={async (name) => setFilter(await repo.createFolder(name))}
        onClose={close}
      />
      <PromptDialog
        visible={state?.type === 'rename' && !!folder}
        title={t('rename')}
        initial={folder?.name ?? ''}
        onConfirm={(name) => folder && repo.renameFolder(folder.id, name)}
        onClose={close}
      />
      <ConfirmDialog
        visible={state?.type === 'deleteFolder' && !!folder}
        title={t('deleteFolderQ', { name: folder?.name ?? '' })}
        // 친구와 함께 쓰는 내 폴더면 누가 더 이상 볼 수 없게 되는지 함께 보인다
        body={sharedWith.length ? `${t('deleteSharedBody', { names: joinNames(sharedWith) })} ${t('deleteFolderBody')}` : t('deleteFolderBody')}
        confirmLabel={sharedWith.length ? t('deleteFolderAll') : t('delete')}
        danger
        onConfirm={async () => {
          if (!folder) return;
          if (filter === folder.id) setFilter(null);
          const moved = await repo.deleteFolder(folder.id);
          showToast({ message: t('deleted'), action: { label: t('undo'), run: () => repo.undoDeleteFolder(folder.id, moved) } });
        }}
        onClose={close}
      />
    </>
  );
}

function FolderPick({ current, folders, onPick }: { current: string | null; folders: Folder[]; onPick: (id: string | null) => void }) {
  const { theme, t } = useUi();
  return (
    <>
      <SheetTitle title={t('classify')} />
      {[{ id: null as string | null, name: t('baseFolder') }, ...folders].map((f) => (
        <SheetButton
          key={f.id ?? 'none'}
          label={f.name}
          selected={f.id === current}
          icon={<FolderIcon color={f.id === current ? theme.accent : theme.muted} size={20} />}
          onPress={() => onPick(f.id)}
        />
      ))}
    </>
  );
}

function DatePick({ initial, onPick }: { initial: string | null; onPick: (d: string | null) => void }) {
  const { theme, t } = useUi();
  const [month, setMonth] = useState(initial ? parseLocalDate(initial) : new Date());
  return (
    <View style={{ padding: 14 }}>
      <SheetTitle title={t('setDate')} />
      <View style={styles.quick}>
        <Chip label={t('today')} onPress={() => onPick(localDate(new Date()))} />
        <Chip label={t('tomorrow')} onPress={() => onPick(localDate(new Date(Date.now() + 86400000)))} />
        {initial ? <Chip label={t('clearDate')} onPress={() => onPick(null)} color={theme.danger} /> : null}
      </View>
      <MonthGrid month={month} setMonth={setMonth} selected={initial} onSelect={onPick} />
    </View>
  );
}

function ReminderPick({ initial, due, onPick }: { initial: number | null; due: string | null; onPick: (at: number | null) => void }) {
  const { theme, t } = useUi();
  const base = initial ? new Date(initial) : due ? parseLocalDate(due) : new Date();
  if (!initial) base.setHours(9, 0, 0, 0);
  const [date, setDate] = useState(localDate(base));
  const [month, setMonth] = useState(base);
  const [hour, setHour] = useState(base.getHours());
  const [minute, setMinute] = useState(base.getMinutes() - (base.getMinutes() % 5));
  const [perm, setPerm] = useState<string>('granted');
  const [exact, setExact] = useState(true);
  useEffect(() => {
    if (!native.available) return;
    native.notificationPermission().then(setPerm);
    native.canScheduleExactAlarms().then(setExact);
  }, []);
  const at = () => {
    const d = parseLocalDate(date);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  };
  const confirm = async () => {
    if (native.available && perm !== 'granted') {
      const r = await native.requestNotificationPermission();
      setPerm(r);
      if (r !== 'granted') return;
    }
    onPick(at());
  };
  const step = (v: number, d: number, max: number) => (v + d + max) % max;
  return (
    <View style={{ padding: 14 }}>
      <SheetTitle title={t('setReminder')} />
      <MonthGrid month={month} setMonth={setMonth} selected={date} onSelect={setDate} />
      <View style={styles.time}>
        <Stepper unit="hour" value={hour} onMinus={() => setHour(step(hour, -1, 24))} onPlus={() => setHour(step(hour, 1, 24))} />
        <Text style={theme.font(26, { color: theme.text })}>:</Text>
        <Stepper unit="minute" value={minute} onMinus={() => setMinute(step(minute, -5, 60))} onPlus={() => setMinute(step(minute, 5, 60))} />
      </View>
      {native.available && perm === 'denied' ? (
        <Text style={theme.font(13, { color: theme.danger, textAlign: 'center', marginBottom: 8 })}>
          {t('reminderDenied')}
        </Text>
      ) : null}
      {native.available && !exact ? (
        <Pressable onPress={() => native.openExactAlarmSettings()}>
          <Text style={theme.font(13, { color: theme.muted, textAlign: 'center', marginBottom: 8 })}>
            {t('exactAlarm')}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.quick}>
        {initial ? <Chip label={t('clearReminder')} onPress={() => onPick(null)} color={theme.danger} /> : null}
        <View style={{ flex: 1 }} />
        <Chip label={t('save')} onPress={confirm} color={theme.accent} />
      </View>
    </View>
  );
}

function Stepper({ value, onMinus, onPlus, unit }: { value: number; onMinus: () => void; onPlus: () => void; unit: 'hour' | 'minute' }) {
  const { theme, t } = useUi();
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={onPlus}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t(unit === 'hour' ? 'hourUp' : 'minuteUp')}
        style={{ transform: [{ rotate: '180deg' }] }}
      >
        <ChevronIcon color={theme.muted} dir="down" size={22} />
      </Pressable>
      <Text style={theme.font(30, { color: theme.text, marginVertical: 2, fontVariant: ['tabular-nums'] })}>
        {String(value).padStart(2, '0')}
      </Text>
      <Pressable onPress={onMinus} hitSlop={10} accessibilityRole="button" accessibilityLabel={t(unit === 'hour' ? 'hourDown' : 'minuteDown')}>
        <ChevronIcon color={theme.muted} dir="down" size={22} />
      </Pressable>
    </View>
  );
}

function Chip({ label, onPress, color }: { label: string; onPress: () => void; color?: string }) {
  const { theme } = useUi();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: theme.raised }]}>
      <Text style={theme.font(14, { color: color ?? theme.text })}>{label}</Text>
    </Pressable>
  );
}

/**
 * 폴더 메뉴. 내 폴더: 이름 바꾸기·글로 공유·친구에게 공유·계정으로 공유(공유 관리)·삭제.
 * 공유받은 폴더: 글로 공유·공유 관리(참여자 보기)·홈에서 숨기기(내 설정만, 공유는 그대로)·내 폴더에 복사·공유 폴더 나가기(셋을 분명히 나눈다).
 */
const styles = StyleSheet.create({
  info: { paddingBottom: 10 },
  quick: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, marginVertical: 10, alignItems: 'center' },
  chip: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9 },
  time: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginVertical: 8 },
  stepper: { alignItems: 'center' },
});
