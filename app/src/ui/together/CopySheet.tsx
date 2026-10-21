import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { toPlain } from '../../core/rich';
import { errorText } from '../../i18n';
import { useApp } from '../../state/AppContext';
import { liveFolders, visibleParagraphs } from '../home/model';
import { CheckIcon, FolderIcon, PlusIcon } from '../Icons';
import { Sheet, SheetButton, SheetTitle, Switch } from '../primitives';

export type CopySource = { folderId: string; todoIds?: string[] };

/**
 * 내 폴더에 복사: 공유 폴더(또는 고른 할 일)를 새 id의 독립된 내 데이터로. 이후 원본과 동기화되지 않는다.
 * 복사할 곳(새 폴더·기본·내 폴더)과 가져갈 것(메모·할 일, 고르는 목록은 폴더 고르기와 같은 진하게/옅게 표시)을 고르고,
 * 날짜·반복을 가져갈지 분명히 고른다. 할 일은 미완료·알림 없이 시작하고, 메모는 대상 메모 뒤에 '— ○○에서 복사 —' 줄과 함께 덧붙는다.
 * 공유 권한·참여자·수정/완료 기록은 가져가지 않는다('홈에 표시'와는 다른 기능).
 */
export function CopySheet({ source, onClose, onCopied }: { source: CopySource | null; onClose: () => void; onCopied?: (folderId: string | null) => void }) {
  const { t, theme, snap, repo, showToast } = useApp();
  const [target, setTarget] = useState<string | null | 'new'>('new');
  const [memo, setMemo] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [keepDates, setKeepDates] = useState(true);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<CopySource | null>(null);

  const folder = source ? snap.folders.find((f) => f.id === source.folderId) : undefined;
  const todos = useMemo(
    () => (source ? snap.todos.filter((x) => x.folder_id === source.folderId && !x.deleted_at) : []),
    [snap.todos, source],
  );
  const paragraphs = useMemo(
    () => (source ? visibleParagraphs({ paragraphs: snap.paragraphs, folders: snap.folders }, source.folderId, '').filter((p) => p.text.trim()) : []),
    [snap.paragraphs, snap.folders, source],
  );
  // 열릴 때마다: 폴더 전체면 새 폴더로·전부, 고른 할 일이면 기본 폴더로·그 할 일만
  if (source !== seen) {
    setSeen(source);
    if (source) {
      setTarget(source.todoIds ? null : 'new');
      setMemo(!source.todoIds);
      setPicked(new Set(source.todoIds ?? todos.map((x) => x.id)));
      setKeepDates(true);
    }
  }
  const foreign = useMemo(() => new Set(snap.shared.map((s) => s.folder_id)), [snap.shared]);
  const mine = useMemo(() => liveFolders(snap.folders).filter((f) => !foreign.has(f.id)), [snap.folders, foreign]);
  if (!source || !folder) return null;

  const chosen = todos.filter((x) => picked.has(x.id));
  const withMemo = memo && paragraphs.length > 0;
  const nothing = !chosen.length && !withMemo;
  const targetName = (id: string | null | 'new') => (id === 'new' ? folder.name : id ? (mine.find((f) => f.id === id)?.name ?? '') : t('baseFolder'));

  const copy = async () => {
    if (nothing || busy) return;
    setBusy(true);
    try {
      const dest = target === 'new' ? await repo.createFolder(folder.name) : target;
      const hasMemo = target !== 'new' && snap.paragraphs.some((p) => p.folder_id === dest && !p.deleted_at && p.text.trim());
      await repo.copyItems({
        todos: chosen.map((x) => ({ text: x.text, due_date: x.due_date, repeat_freq: x.repeat_freq, repeat_days: x.repeat_days })),
        paragraphs: withMemo ? paragraphs.map((p) => p.text) : [],
        target: dest,
        keepDates,
        // 대상에 이미 메모가 있으면 덮어쓰지 않고 어디서 왔는지 한 줄 두고 덧붙인다
        header: hasMemo ? t('copyHeader', { folder: folder.name }) : undefined,
      });
      showToast({ message: t('copyDone', { folder: targetName(target) }) });
      onCopied?.(dest);
      onClose();
    } catch (e) {
      showToast({ message: errorText(e, t) });
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Sheet visible onClose={onClose} dialog>
      <SheetTitle title={t('copyToMine')} subtitle={folder.name} />
      <Text style={[theme.kfont(14, { color: theme.muted, lineHeight: 20 }), styles.pad]}>{t('copyHint')}</Text>

      <Text style={[theme.font(13, { color: theme.muted }), styles.label]}>{t('copyTarget')}</Text>
      {(['new', null, ...mine.map((f) => f.id)] as (string | null | 'new')[]).map((id) => (
        <SheetButton
          key={id ?? 'base'}
          label={id === 'new' ? t('copyNewFolder', { name: folder.name }) : targetName(id)}
          selected={target === id}
          icon={id === 'new' ? <PlusIcon color={target === id ? theme.accent : theme.muted} size={20} strokeWidth={1.8} /> : <FolderIcon color={target === id ? theme.accent : theme.muted} size={20} />}
          onPress={() => setTarget(id)}
        />
      ))}

      {paragraphs.length ? (
        <View style={styles.switchRow}>
          <Text style={theme.kfont(16, { color: theme.text, flex: 1 })} numberOfLines={1}>
            {t('copyMemo')} <Text style={{ color: theme.muted }}>{toPlain(paragraphs[0].text).slice(0, 30)}</Text>
          </Text>
          <Switch value={memo} onChange={setMemo} label={t('copyMemo')} size="sm" />
        </View>
      ) : null}
      {todos.length ? <Text style={[theme.font(13, { color: theme.muted }), styles.label]}>{`${t('copyTodos')} ${chosen.length}/${todos.length}`}</Text> : null}
      {todos.map((x) => (
        <SheetButton
          key={x.id}
          label={toPlain(x.text)}
          selected={picked.has(x.id)}
          icon={<View style={styles.check}>{picked.has(x.id) ? <CheckIcon color={theme.accent} size={18} /> : null}</View>}
          onPress={() => toggle(x.id)}
        />
      ))}
      <View style={styles.switchRow}>
        <Text style={theme.kfont(16, { color: theme.text, flex: 1 })}>{t('copyKeepDates')}</Text>
        <Switch value={keepDates} onChange={setKeepDates} label={t('copyKeepDates')} size="sm" />
      </View>
      <View style={styles.pad}>
        <Pressable
          accessibilityRole="button"
          disabled={nothing || busy}
          onPress={() => void copy()}
          style={[styles.primary, { backgroundColor: theme.accent, opacity: nothing ? 0.45 : 1 }]}
        >
          {busy ? <ActivityIndicator color={theme.onAccent} /> : <Text style={theme.kfont(15.5, { color: theme.onAccent, fontWeight: '700' })}>{t('copyButton')}</Text>}
        </Pressable>
      </View>
      <View style={{ height: 12 }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 22, paddingBottom: 6 },
  label: { paddingHorizontal: 22, marginTop: 14, marginBottom: 4 },
  check: { width: 20, alignItems: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, minHeight: 52, gap: 12 },
  primary: { marginTop: 12, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
