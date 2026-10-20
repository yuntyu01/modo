import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '../state/AppContext';
import { Composer } from '../ui/home/Composer';
import { contentColumn } from '../ui/layout';

/**
 * 빠른 추가(iOS 위젯 +가 naegirok://quickadd 로 연다. 제어 센터 버튼은 뺐다 2026-10-21).
 * Android는 앱을 띄우지 않는 네이티브 창(QuickAddActivity)을 쓰고, 이 화면은 대체 경로다.
 * 위젯이 넘긴 폴더(없거나 지워졌으면 기본)에 저장하고, 어디에 저장되는지 안내 문구에 보여 준다.
 */
export default function QuickAdd() {
  const { repo, prefs, theme, t, showToast, snap } = useApp();
  const params = useLocalSearchParams<{ folder?: string }>();
  const folder = snap.folders.find((f) => f.id === params.folder && !f.deleted_at) ?? null;
  const folderId = folder?.id ?? null;
  const [todoMode, setTodoMode] = useState(true);
  const [draft, setDraft] = useState('');
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View style={styles.root}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('cancel')} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.bottom}>
        <View style={[contentColumn, styles.panel, { backgroundColor: theme.card }]}>
          <Text style={theme.font(13, { color: theme.muted, marginLeft: 12, marginBottom: 8 })}>
            {t('quickAdd')} · {folder?.name ?? t('baseFolder')}
          </Text>
          <Composer
            autoFocus
            todoMode={todoMode}
            setTodoMode={setTodoMode}
            draft={draft}
            setDraft={setDraft}
            onSubmit={async (asTodo, text) => {
              if (asTodo) await repo.addTodo(text, folderId, prefs.newTodoAt);
              else await repo.appendParagraphs(text, folderId);
              showToast({ message: asTodo ? t('newTodo') : t('continueMemo') });
              close();
              return true;
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  bottom: { flex: 1, justifyContent: 'flex-end' },
  panel: { borderRadius: 26, padding: 12, margin: 12 },
});
