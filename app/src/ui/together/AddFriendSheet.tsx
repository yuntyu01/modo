import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Person } from '../../core/types';
import { errorText } from '../../i18n';
import { useApp } from '../../state/AppContext';
import { personHandle, personName, useFriends, type FriendRequest } from '../../state/friends';
import { mix } from '../color';
import { CloseIcon, SearchIcon } from '../Icons';
import { Sheet } from '../primitives';
import { inputColors } from '../theme';

/**
 * 친구 추가(시안): 제목·설명 → 친구 이메일 찾기(보내기) → 받은 요청(거절·수락) → 보낸 요청(취소) → '친구가 되어도 공유한 폴더만 보여요.'
 * 상대가 이미 내게 요청했으면 보내는 즉시 친구가 된다(서버가 처리).
 */
export function AddFriendSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme, t, showToast, serverApi } = useApp();
  const friends = useFriends();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { incoming, outgoing } = friends.data;
  // 시안: 옅은 바탕 시트 위의 흰 카드
  const cardBg = theme.dark ? '#22252A' : '#FFFFFF';

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(null);
    }
  };
  const send = () => {
    const v = email.trim();
    if (!v) return;
    void run('send', async () => {
      const r = await friends.request(v);
      setEmail('');
      showToast({ message: r.status === 'accepted' && r.friend ? t('friendAccepted', { name: personName(r.friend) }) : t('friendRequested') });
    });
  };

  const who = (p: Person) => (
    <View style={{ flex: 1, marginRight: 10 }}>
      <Text numberOfLines={1} style={theme.kfont(17, { color: theme.text, fontWeight: '700' })}>
        {personName(p)}
      </Text>
      {personHandle(p) ? (
        <Text numberOfLines={1} style={theme.font(14, { color: theme.muted, marginTop: 3 })}>
          {personHandle(p)}
        </Text>
      ) : null}
    </View>
  );
  const textButton = (label: string, onPress: () => void, key: string) => (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={!!busy} hitSlop={8} style={styles.textBtn}>
      {busy === key ? <ActivityIndicator color={theme.muted} /> : <Text style={theme.kfont(15, { color: theme.muted })}>{label}</Text>}
    </Pressable>
  );
  const requestCard = (r: FriendRequest, kind: 'in' | 'out') => (
    <View key={r.id} style={[styles.card, { backgroundColor: cardBg }]}>
      {who(r.user)}
      {kind === 'in' ? (
        <>
          {textButton(t('friendDecline'), () => void run(`no:${r.id}`, () => friends.dismiss(r.id)), `no:${r.id}`)}
          <Pressable
            accessibilityRole="button"
            disabled={!!busy}
            onPress={() =>
              void run(`ok:${r.id}`, async () => {
                const p = await friends.accept(r.id);
                showToast({ message: t('friendAccepted', { name: personName(p) }) });
              })
            }
            style={[styles.accept, { backgroundColor: mix(cardBg, theme.accent, theme.dark ? 0.22 : 0.14) }]}
          >
            {busy === `ok:${r.id}` ? (
              <ActivityIndicator color={theme.accent} />
            ) : (
              <Text style={theme.kfont(15, { color: theme.accent, fontWeight: '600' })}>{t('friendAccept')}</Text>
            )}
          </Pressable>
        </>
      ) : (
        textButton(t('cancel'), () => void run(`cancel:${r.id}`, () => friends.dismiss(r.id)), `cancel:${r.id}`)
      )}
    </View>
  );
  const section = (title: string, n: number) => (
    <Text style={[theme.kfont(16, { color: theme.text, fontWeight: '700' }), styles.section]}>
      {title} <Text style={theme.font(16, { color: theme.muted, fontWeight: '400' })}>{n}</Text>
    </Text>
  );

  return (
    <Sheet visible={visible} onClose={onClose} soft>
      <View style={styles.body}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={theme.kfont(26, { color: theme.text, fontWeight: '700' })}>{t('friendsAdd')}</Text>
            <Text style={theme.kfont(15.5, { color: theme.muted, marginTop: 6 })}>{t('friendsAddHint')}</Text>
          </View>
          <Pressable accessibilityLabel={t('close')} onPress={onClose} hitSlop={12} style={{ marginTop: 2 }}>
            <CloseIcon color={theme.subtle} size={24} />
          </Pressable>
        </View>

        <View style={[styles.search, { backgroundColor: theme.dark ? cardBg : mix(theme.bg, '#C8D2E2', 0.32) }]}>
          <TextInput
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
            }}
            {...inputColors(theme)}
            placeholder={t('friendEmail')}
            placeholderTextColor={theme.subtle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="search"
            onSubmitEditing={send}
            editable={!!serverApi}
            accessibilityLabel={t('friendEmail')}
            style={[theme.font(16.5, { color: theme.text, flex: 1 }), Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
          />
          <Pressable accessibilityLabel={t('friendsAdd')} accessibilityRole="button" onPress={send} disabled={!email.trim() || !!busy} hitSlop={10}>
            {busy === 'send' ? <ActivityIndicator color={theme.subtle} /> : <SearchIcon color={theme.subtle} size={22} />}
          </Pressable>
        </View>
        {error ? <Text style={theme.font(14, { color: theme.danger, marginTop: 10, marginLeft: 6 })}>{error}</Text> : null}
        {!serverApi ? <Text style={theme.font(14, { color: theme.muted, marginTop: 10, marginLeft: 6 })}>{t('togetherOffline')}</Text> : null}

        {incoming.length ? (
          <>
            {section(t('friendIncoming'), incoming.length)}
            {incoming.map((r) => requestCard(r, 'in'))}
          </>
        ) : null}
        {outgoing.length ? (
          <>
            {section(t('friendOutgoing'), outgoing.length)}
            {outgoing.map((r) => requestCard(r, 'out'))}
          </>
        ) : null}

        <Text style={theme.kfont(14, { color: theme.muted, marginTop: 22, marginLeft: 4 })}>{t('friendsNote')}</Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 22 },
  head: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 },
  search: { flexDirection: 'row', alignItems: 'center', borderRadius: 24, paddingHorizontal: 20, height: 54 },
  section: { marginTop: 26, marginBottom: 12, marginLeft: 4 },
  card: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, paddingLeft: 18, paddingRight: 12, paddingVertical: 14, marginBottom: 10 },
  textBtn: { paddingHorizontal: 12, height: 44, justifyContent: 'center', marginRight: 4 },
  accept: { minWidth: 64, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
});
