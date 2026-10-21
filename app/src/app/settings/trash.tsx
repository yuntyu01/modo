import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { toPlain } from '../../core/rich';
import { useApp } from '../../state/AppContext';
import { formatDateTime } from '../../ui/format';
import { ConfirmDialog } from '../../ui/primitives';
import { Note, SubScreen } from '../../ui/SubScreen';

/** 삭제한 할 일·메모 문단. 복원하거나 영구 삭제한다. */
export default function Trash() {
  const { snap, theme, t, repo, lang } = useApp();
  const [confirm, setConfirm] = useState<null | { entity: 'todo' | 'paragraph'; ids: string[] } | 'all'>(null);
  const items = [
    ...snap.todos.filter((x) => x.deleted_at).map((x) => ({ entity: 'todo' as const, id: x.id, text: toPlain(x.text), at: x.deleted_at! })),
    ...snap.paragraphs.filter((x) => x.deleted_at).map((x) => ({ entity: 'paragraph' as const, id: x.id, text: toPlain(x.text), at: x.deleted_at! })),
  ].sort((a, b) => b.at - a.at);

  return (
    <SubScreen title={t('trash')}>
      {items.length === 0 ? (
        <Note>{t('trashEmpty')}</Note>
      ) : (
        <>
          {items.map((it) => (
            <View key={it.id} style={[styles.item, { backgroundColor: theme.card }]}>
              <View style={{ flex: 1 }}>
                <Text style={theme.font(16, { color: theme.text })} numberOfLines={3}>
                  {it.text || ' '}
                </Text>
                <Text style={theme.font(12, { color: theme.muted, marginTop: 4 })}>
                  {it.entity === 'todo' ? t('todoSection') : t('memoParagraph')} · {formatDateTime(it.at, lang)}
                </Text>
              </View>
              {/* 복원·삭제는 블록 없이 글자만(사용자 요청 2026-10-18) */}
              <Pressable hitSlop={8} accessibilityRole="button" onPress={() => repo.restore(it.entity, [it.id])} style={styles.btn}>
                <Text style={theme.font(14, { color: theme.accent, fontWeight: '600' })}>{t('restore')}</Text>
              </Pressable>
              <Pressable hitSlop={8} accessibilityRole="button" onPress={() => setConfirm({ entity: it.entity, ids: [it.id] })} style={styles.btn}>
                <Text style={theme.font(14, { color: theme.danger })}>{t('delete')}</Text>
              </Pressable>
            </View>
          ))}
          <Pressable onPress={() => setConfirm('all')} style={styles.empty}>
            <Text style={theme.font(15, { color: theme.danger })}>{t('emptyTrash')}</Text>
          </Pressable>
        </>
      )}
      <ConfirmDialog
        visible={confirm !== null}
        title={t('purgeQ')}
        confirmLabel={t('delete')}
        danger
        onConfirm={async () => {
          if (confirm === 'all') {
            await repo.purge('todo', items.filter((i) => i.entity === 'todo').map((i) => i.id));
            await repo.purge('paragraph', items.filter((i) => i.entity === 'paragraph').map((i) => i.id));
          } else if (confirm) await repo.purge(confirm.entity, confirm.ids);
        }}
        onClose={() => setConfirm(null)}
      />
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 16, marginBottom: 8, gap: 8 },
  btn: { paddingHorizontal: 6, paddingVertical: 6 },
  empty: { alignItems: 'center', padding: 18 },
});
