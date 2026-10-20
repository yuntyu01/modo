import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CodedError } from '../../core/errors';
import type { Person } from '../../core/types';
import { errorText } from '../../i18n';
import { useApp } from '../../state/AppContext';
import { personHandle, personName, useFriends, type FriendRequest, type FriendSearch } from '../../state/friends';
import { mix } from '../color';
import { ChevronIcon, CloseIcon, SearchIcon } from '../Icons';
import { Sheet } from '../primitives';
import { inputColors } from '../theme';

/**
 * 친구 추가(시안): 제목·설명 → 친구 이메일 찾기 → 찾은 사람과 '요청 보내기' → 받은 요청 N(거절·수락) → 접을 수 있는 보낸 요청(취소) →
 * '친구가 되어도 공유한 폴더만 보여요.' 찾기만으로는 보내지 않는다. 요청·수락·거절·취소는 서버가 받아들인 뒤에만 화면에 반영한다.
 * 휴대폰은 바텀시트, PC는 가운데 대화상자.
 */
export function AddFriendSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme, t, showToast, serverApi } = useApp();
  const friends = useFriends();
  const [email, setEmail] = useState('');
  const [found, setFound] = useState<FriendSearch | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOutgoing, setShowOutgoing] = useState(false);
  const { incoming, outgoing } = friends.data;
  // 시안: 옅은 바탕 시트 위의 흰 카드
  const cardBg = theme.dark ? '#22252A' : '#FFFFFF';

  // 이름이 같은 사람이 목록에 둘 이상이면 이메일 전체로 구분한다(동명이인은 서로 다른 사용자 id)
  const everyone: Person[] = [...friends.data.friends, ...incoming.map((r) => r.user), ...outgoing.map((r) => r.user)];
  const idLine = (p: Person) => {
    const same = everyone.filter((o) => o.id !== p.id && personName(o) === personName(p)).length;
    return same ? p.email : personHandle(p);
  };

  const close = () => {
    setEmail('');
    setFound(null);
    setError(null);
    onClose();
  };
  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      // 상대가 먼저 처리했거나(수락·취소) 이미 받은 요청이 있으면: 최신 상태를 다시 받아 보여 준다
      if (e instanceof CodedError && ['request_closed', 'request_not_found', 'request_incoming', 'already_friends'].includes(e.code)) void friends.refresh();
      setError(errorText(e, t));
    } finally {
      setBusy(null);
    }
  };
  const search = () => {
    const v = email.trim();
    if (!v || !serverApi) return;
    void run('search', async () => {
      setFound(null);
      setFound(await friends.search(v));
    });
  };
  const send = (f: FriendSearch) =>
    run('send', async () => {
      try {
        await friends.request(f.user.email, f.user.id);
        setFound({ ...f, status: 'outgoing' });
        showToast({ message: t('friendRequested') });
      } catch (e) {
        // 그 사이 상대가 먼저 요청했다: 받은 요청을 수락하도록 결과를 바꿔 보여 준다
        if (e instanceof CodedError && e.code === 'request_incoming') setFound(await friends.search(f.user.email));
        throw e;
      }
    });
  const accept = (id: string) =>
    run(`ok:${id}`, async () => {
      const p = await friends.accept(id);
      if (found?.request_id === id) setFound({ ...found, status: 'friend', request_id: undefined });
      showToast({ message: t('friendAccepted', { name: personName(p) }) });
    });

  const who = (p: Person) => (
    <View style={{ flex: 1, marginRight: 10 }}>
      <Text numberOfLines={1} style={theme.kfont(17, { color: theme.text, fontWeight: '700' })}>
        {personName(p)}
      </Text>
      {idLine(p) ? (
        <Text numberOfLines={1} style={theme.font(14, { color: theme.muted, marginTop: 3 })}>
          {idLine(p)}
        </Text>
      ) : null}
    </View>
  );
  const textButton = (label: string, onPress: () => void, key: string) => (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={!!busy} hitSlop={8} style={styles.textBtn}>
      {busy === key ? <ActivityIndicator color={theme.muted} /> : <Text style={theme.kfont(15, { color: theme.muted })}>{label}</Text>}
    </Pressable>
  );
  const primary = (label: string, onPress: () => void, key: string) => (
    <Pressable
      accessibilityRole="button"
      disabled={!!busy}
      onPress={onPress}
      style={[styles.accept, { backgroundColor: mix(cardBg, theme.accent, theme.dark ? 0.22 : 0.14) }]}
    >
      {busy === key ? <ActivityIndicator color={theme.accent} /> : <Text style={theme.kfont(15, { color: theme.accent, fontWeight: '600' })}>{label}</Text>}
    </Pressable>
  );
  const quiet = (label: string) => <Text style={[theme.kfont(15, { color: theme.subtle }), styles.quiet]}>{label}</Text>;

  const result = (f: FriendSearch) => (
    <View style={[styles.card, { backgroundColor: cardBg, marginTop: 12 }]}>
      <View style={{ flex: 1, marginRight: 10 }}>
        <Text numberOfLines={1} style={theme.kfont(17, { color: theme.text, fontWeight: '700' })}>
          {personName(f.user)}
        </Text>
        <Text numberOfLines={1} style={theme.font(14, { color: theme.muted, marginTop: 3 })}>
          {f.status === 'incoming' ? t('friendStatusIncoming') : f.user.email}
        </Text>
      </View>
      {f.status === 'none'
        ? primary(t('sendRequest'), () => void send(f), 'send')
        : f.status === 'outgoing'
          ? quiet(t('requestSent'))
          : f.status === 'friend'
            ? quiet(t('friendStatusFriend'))
            : f.request_id
              ? primary(t('friendAccept'), () => void accept(f.request_id!), `ok:${f.request_id}`)
              : null}
    </View>
  );
  const incomingCard = (r: FriendRequest) => (
    <View key={r.id} style={[styles.card, { backgroundColor: cardBg }]}>
      {who(r.user)}
      {textButton(
        t('friendDecline'),
        () =>
          void run(`no:${r.id}`, async () => {
            await friends.decline(r.id);
            showToast({ message: t('requestDeclined') });
          }),
        `no:${r.id}`,
      )}
      {primary(t('friendAccept'), () => void accept(r.id), `ok:${r.id}`)}
    </View>
  );
  const outgoingCard = (r: FriendRequest) => (
    <View key={r.id} style={[styles.card, { backgroundColor: cardBg }]}>
      {who(r.user)}
      {textButton(
        t('friendCancel'),
        () =>
          void run(`cancel:${r.id}`, async () => {
            await friends.cancel(r.id);
            if (found?.user.id === r.user.id) setFound({ ...found, status: 'none' });
            showToast({ message: t('requestCancelled') });
          }),
        `cancel:${r.id}`,
      )}
    </View>
  );

  return (
    <Sheet visible={visible} onClose={close} soft dialog>
      <View style={styles.body}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={theme.kfont(26, { color: theme.text, fontWeight: '700' })}>{t('friendsAdd')}</Text>
            <Text style={theme.kfont(15.5, { color: theme.muted, marginTop: 6 })}>{t('friendsAddHint')}</Text>
          </View>
          <Pressable accessibilityLabel={t('close')} onPress={close} hitSlop={12} style={{ marginTop: 2 }}>
            <CloseIcon color={theme.subtle} size={24} />
          </Pressable>
        </View>

        <View style={[styles.search, { backgroundColor: theme.dark ? cardBg : mix(theme.bg, '#C8D2E2', 0.32) }]}>
          <TextInput
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
              if (found && v.trim().toLowerCase() !== found.user.email.toLowerCase()) setFound(null);
            }}
            {...inputColors(theme)}
            placeholder={t('friendEmail')}
            placeholderTextColor={theme.subtle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="search"
            onSubmitEditing={search}
            editable={!!serverApi}
            accessibilityLabel={t('friendEmail')}
            style={[theme.font(16.5, { color: theme.text, flex: 1 }), Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
          />
          <Pressable accessibilityLabel={t('friendSearch')} accessibilityRole="button" onPress={search} disabled={!email.trim() || !!busy || !serverApi} hitSlop={10}>
            {busy === 'search' ? <ActivityIndicator color={theme.subtle} /> : <SearchIcon color={theme.subtle} size={22} />}
          </Pressable>
        </View>
        {found ? result(found) : null}
        {error ? <Text style={theme.font(14, { color: theme.danger, marginTop: 10, marginLeft: 6 })}>{error}</Text> : null}
        {!serverApi ? <Text style={theme.font(14, { color: theme.muted, marginTop: 10, marginLeft: 6 })}>{t('togetherOffline')}</Text> : null}

        <Text style={[theme.kfont(16, { color: theme.text, fontWeight: '700' }), styles.section]}>
          {t('friendIncoming')} <Text style={theme.font(16, { color: theme.muted, fontWeight: '400' })}>{incoming.length}</Text>
        </Text>
        {incoming.length ? incoming.map(incomingCard) : <Text style={theme.kfont(14.5, { color: theme.subtle, marginLeft: 4, marginBottom: 4 })}>{t('noIncoming')}</Text>}

        {outgoing.length ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showOutgoing }}
              onPress={() => setShowOutgoing((v) => !v)}
              hitSlop={8}
              style={[styles.section, styles.toggle]}
            >
              <Text style={theme.kfont(15, { color: theme.muted })}>
                {t('friendOutgoing')} {outgoing.length}
              </Text>
              <View style={{ marginLeft: 4, transform: [{ rotate: showOutgoing ? '180deg' : '0deg' }] }}>
                <ChevronIcon color={theme.muted} dir="down" size={16} strokeWidth={1.7} />
              </View>
            </Pressable>
            {showOutgoing ? outgoing.map(outgoingCard) : null}
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
  toggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 20 },
  card: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, paddingLeft: 18, paddingRight: 12, paddingVertical: 14, marginBottom: 10 },
  textBtn: { paddingHorizontal: 12, height: 44, justifyContent: 'center', marginRight: 4 },
  accept: { minWidth: 64, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  quiet: { paddingHorizontal: 8 },
});
