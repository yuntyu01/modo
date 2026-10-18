import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Folder } from '../core/types';
import { resolveLang } from '../i18n';
import { native } from '../native/bridge';
import { useApp } from '../state/AppContext';
import { ruleOf } from '../core/repeat';
import { describeRepeat, formatDate, formatDateTime, localDate, parseLocalDate } from './format';
import { BellIcon, CalendarIcon, ChevronIcon, EditIcon, FolderIcon, PeopleIcon, RepeatIcon, ShareIcon, TrashIcon } from './Icons';
import { MonthGrid } from './MonthGrid';
import { ConfirmDialog, InfoRow, PromptDialog, Sheet, SheetButton, SheetTitle } from './primitives';
import { RepeatSheet } from './RepeatSheet';
import { folderAsText, shareText } from './share';

export type SheetState =
  | { type: 'todo'; id: string }
  | { type: 'paragraph'; id: string }
  | { type: 'folderPick'; entity: 'todo' | 'paragraph'; id: string }
  | { type: 'date'; id: string }
  | { type: 'remind'; id: string }
  | { type: 'repeat'; id: string }
  | { type: 'folder'; id: string }
  | { type: 'rename'; id: string }
  | { type: 'deleteFolder'; id: string }
  | { type: 'newFolder' }
  | null;

export function ItemSheets({ state, setState }: { state: SheetState; setState: (s: SheetState) => void }) {
  const app = useApp();
  const { snap, repo, t, theme, prefs, showToast, canWrite, setFilter, filter } = app;
  const lang = resolveLang(prefs.language);
  const close = () => setState(null);
  const folderName = (id: string | null) => (id ? (snap.folders.find((f) => f.id === id)?.name ?? t('unfiled')) : t('unfiled'));

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

  return (
    <>
      <Sheet visible={state?.type === 'todo' && !!todo} onClose={close}>
        {todo ? (
          <>
            <SheetTitle title={t('todoInfo')} subtitle={todo.text} />
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
            {canWrite(todo.folder_id) ? (
              <>
                <SheetButton icon={<FolderIcon color={theme.text} size={20} />} label={t('classify')} onPress={() => setState({ type: 'folderPick', entity: 'todo', id: todo.id })} />
                <SheetButton icon={<CalendarIcon color={theme.text} size={20} />} label={t('setDate')} onPress={() => setState({ type: 'date', id: todo.id })} />
                <SheetButton icon={<BellIcon color={theme.text} size={20} />} label={t('setReminder')} onPress={() => setState({ type: 'remind', id: todo.id })} />
                <SheetButton icon={<RepeatIcon color={theme.text} size={20} />} label={t('repeat')} onPress={() => setState({ type: 'repeat', id: todo.id })} />
                <SheetButton icon={<ShareIcon color={theme.text} size={20} />} label={t('share')} onPress={() => doShare(todo.text)} />
                <SheetButton icon={<TrashIcon color={theme.danger} size={20} />} label={t('delete')} danger onPress={() => trashWithUndo('todo', todo.id)} />
              </>
            ) : (
              <SheetButton icon={<ShareIcon color={theme.text} size={20} />} label={t('share')} onPress={() => doShare(todo.text)} />
            )}
          </>
        ) : null}
      </Sheet>

      <Sheet visible={state?.type === 'paragraph' && !!para} onClose={close}>
        {para ? (
          <>
            <SheetTitle title={t('paragraphInfo')} subtitle={para.text || ' '} />
            <View style={styles.info}>
              <InfoRow label={t('createdAt')} value={formatDateTime(para.created_at, lang)} />
              <InfoRow label={t('updatedAt')} value={formatDateTime(para.updated_at, lang)} />
              <InfoRow label={t('folder')} value={folderName(para.folder_id)} />
            </View>
            {canWrite(para.folder_id) ? (
              <>
                <SheetButton icon={<FolderIcon color={theme.text} size={20} />} label={t('classify')} onPress={() => setState({ type: 'folderPick', entity: 'paragraph', id: para.id })} />
                <SheetButton icon={<ShareIcon color={theme.text} size={20} />} label={t('share')} onPress={() => doShare(para.text)} />
                <SheetButton icon={<TrashIcon color={theme.danger} size={20} />} label={t('delete')} danger onPress={() => trashWithUndo('paragraph', para.id)} />
              </>
            ) : (
              <SheetButton icon={<ShareIcon color={theme.text} size={20} />} label={t('share')} onPress={() => doShare(para.text)} />
            )}
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

      <Sheet visible={state?.type === 'folder' && !!folder} onClose={close}>
        {folder ? (
          <FolderMenu
            folder={folder}
            onRename={() => setState({ type: 'rename', id: folder.id })}
            onShareText={() =>
              doShare(
                folderAsText(
                  folder.name,
                  snap.paragraphs.filter((p) => p.folder_id === folder.id && !p.deleted_at),
                  snap.todos.filter((x) => x.folder_id === folder.id && !x.deleted_at),
                ),
              )
            }
            onShareAccount={() => {
              close();
              router.push({ pathname: '/share/[id]', params: { id: folder.id } });
            }}
            onDelete={() => setState({ type: 'deleteFolder', id: folder.id })}
          />
        ) : null}
      </Sheet>

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
        body={t('deleteFolderBody')}
        confirmLabel={t('delete')}
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
  const { theme, t } = useApp();
  return (
    <>
      <SheetTitle title={t('classify')} />
      {[{ id: null as string | null, name: t('unfiled') }, ...folders].map((f) => (
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
  const { theme, t } = useApp();
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
  const { theme, t } = useApp();
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
  const { theme, t } = useApp();
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
  const { theme } = useApp();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: theme.raised }]}>
      <Text style={theme.font(14, { color: color ?? theme.text })}>{label}</Text>
    </Pressable>
  );
}

function FolderMenu({
  folder,
  onRename,
  onShareText,
  onShareAccount,
  onDelete,
}: {
  folder: Folder;
  onRename: () => void;
  onShareText: () => void;
  onShareAccount: () => void;
  onDelete: () => void;
}) {
  const { theme, t, snap, serverApi, account } = useApp();
  const mine = !snap.shared.some((s) => s.folder_id === folder.id);
  return (
    <>
      <SheetTitle title={t('folder')} subtitle={folder.name} />
      {mine ? <SheetButton icon={<EditIcon color={theme.text} size={20} />} label={t('rename')} onPress={onRename} /> : null}
      <SheetButton icon={<ShareIcon color={theme.text} size={20} />} label={t('shareText')} onPress={onShareText} />
      {/* 계정으로 함께 쓰기는 서버가 있어야 해서 서버에 닿고 로그인했을 때만 */}
      {mine && serverApi && account ? <SheetButton icon={<PeopleIcon color={theme.text} size={20} />} label={t('shareAccount')} onPress={onShareAccount} /> : null}
      {mine ? <SheetButton icon={<TrashIcon color={theme.danger} size={20} />} label={t('delete')} danger onPress={onDelete} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  info: { paddingBottom: 10 },
  quick: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, marginVertical: 10, alignItems: 'center' },
  chip: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9 },
  time: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginVertical: 8 },
  stepper: { alignItems: 'center' },
});
