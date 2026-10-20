import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { errorText } from '../../i18n';
import { useApp } from '../../state/AppContext';
import { ChevronIcon, LinkIcon, PersonIcon } from '../../ui/Icons';
import { ConfirmDialog, Group, Row, Sheet, SheetButton, SheetTitle, Switch } from '../../ui/primitives';
import { Note, SubScreen } from '../../ui/SubScreen';
import { inputColors } from '../../ui/theme';

type Role = 'view' | 'edit';
type Member = { user_id: string; email: string; name: string; role: Role };
type Link = { token: string; link_path: string };
type Shares = { members: Member[]; links: Link[] };

/**
 * 폴더 공유(시안): 초대(이메일 + 권한 + 초대하기) → 함께하는 사람(나 소유자, 초대한 사람 권한) →
 * 링크 공유(보기 전용 링크 켜기/끄기, 링크 복사) → 공유 중지. 권한은 서버가 다시 확인한다.
 */
export default function ShareFolder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, t, snap, account, sync, showToast } = useApp();
  const folder = snap.folders.find((f) => f.id === id);
  const [shares, setShares] = useState<Shares>({ members: [], links: [] });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('edit');
  const [error, setError] = useState<string | null>(null);
  const [roleSheet, setRoleSheet] = useState<{ member?: Member } | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  // 화면을 닫은 뒤 늦게 온 응답은 버린다
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // 처음 열 때만 동기화를 먼저(폴더가 서버에 올라가 있어야 한다). 초대·권한 바꾸기 뒤에는 목록만 다시 받는다
  // (예전엔 그때마다 전체 동기화를 한 번 더 돌렸다)
  const load = useCallback(
    async (withSync = false) => {
      try {
        if (withSync) await sync.syncNow();
        const s = await sync.shareApi<Shares>(`/api/folders/${id}/shares`);
        if (!alive.current) return;
        setShares(s);
        setError(null);
      } catch (e) {
        if (alive.current) setError(errorText(e, t));
      }
    },
    [id, sync, t],
  );
  useEffect(() => {
    if (!account) return;
    // 상태는 서버 응답을 기다린 뒤에 바뀐다(컴파일러 규칙의 오탐)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(true);
  }, [account, load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e, t));
    }
  };

  if (!folder) return <SubScreen title={t('share')}>{null}</SubScreen>;
  const name = folder.name;
  const link = shares.links[0];
  const roleLabel = (r: Role) => (r === 'edit' ? t('roleEditLong') : t('roleViewLong'));
  const linkUrl = link && account ? `${account.server.replace(/\/+$/, '')}${link.link_path}` : '';

  if (!account) {
    return (
      <SubScreen title={t('shareFolderTitle', { name })}>
        <Note>{t('needLogin')}</Note>
        <Group>
          <Row label={t('account')} onPress={() => router.push('/settings/account')} last />
        </Group>
      </SubScreen>
    );
  }

  const roleButton = (r: Role, onPress: () => void) => (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" style={styles.roleBtn}>
      <Text style={theme.kfont(14.5, { color: theme.subtle })}>{roleLabel(r)}</Text>
      <ChevronIcon color={theme.subtle} dir="down" size={16} strokeWidth={1.7} />
    </Pressable>
  );
  const avatar = (
    <View style={[styles.avatar, { backgroundColor: theme.dark ? '#2A2D33' : theme.raised }]}>
      <PersonIcon color={theme.text} size={20} />
    </View>
  );
  const okEmail = email.includes('@');

  return (
    <SubScreen title={t('shareFolderTitle', { name })}>
      <Text style={theme.kfont(15.7, { color: theme.subtle, marginLeft: 6.5, marginTop: -5, marginBottom: 16 })}>{t('shareIntro')}</Text>

      <View style={[styles.card, { backgroundColor: theme.card, paddingHorizontal: 14, paddingTop: 19, paddingBottom: 19.5 }]}>
        <Text style={theme.kfont(14.5, { color: theme.text, marginLeft: 2.5, marginBottom: 6.75 })}>{t('inviteEmail')}</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder={t('emailPlaceholder')}
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          keyboardType="email-address"
          {...inputColors(theme)}
          style={[
            theme.kfont(15.5, { color: theme.text }),
            styles.input,
            { borderColor: theme.dark ? '#3A3E44' : theme.outline },
            Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
          ]}
        />
        <View style={[styles.permRow, { marginRight: 1.5 }]}>
          <Text style={theme.kfont(14.5, { color: theme.text, flex: 1, marginLeft: 2.5 })}>{t('permission')}</Text>
          {roleButton(role, () => setRoleSheet({}))}
        </View>
        <Pressable
          disabled={!okEmail}
          accessibilityRole="button"
          onPress={() =>
            act(async () => {
              await sync.shareApi(`/api/folders/${id}/members`, { method: 'POST', body: JSON.stringify({ email: email.trim(), role }) });
              setEmail('');
            })
          }
          style={[styles.primary, { backgroundColor: theme.accent }]}
        >
          <Text style={theme.kfont(15.5, { color: theme.onAccent, fontWeight: '700' })}>{t('invite')}</Text>
        </Pressable>
      </View>
      {error ? <Text style={theme.kfont(14, { color: theme.danger, marginHorizontal: 6, marginTop: -8, marginBottom: 14 })}>{error}</Text> : null}

      <Text style={[styles.label, theme.kfont(14.5, { color: theme.tab })]}>{t('members')}</Text>
      <View style={[styles.card, { backgroundColor: theme.card, paddingBottom: 3 }]}>
        <View style={styles.person}>
          {avatar}
          <Text style={theme.kfont(16.5, { color: theme.text, flex: 1, marginLeft: 11 })}>{t('me')}</Text>
          <Text style={theme.kfont(14, { color: theme.subtle })}>{t('owner')}</Text>
        </View>
        {shares.members.map((m) => (
          <View key={m.user_id}>
            <View style={[styles.sep, { backgroundColor: theme.dark ? '#2A2D33' : '#E7E9ED' }]} />
            <View style={styles.person}>
              {avatar}
              <Text style={theme.kfont(16.5, { color: theme.text, flex: 1, marginLeft: 11 })} numberOfLines={1}>
                {m.email || m.name}
              </Text>
              {roleButton(m.role, () => setRoleSheet({ member: m }))}
            </View>
          </View>
        ))}
      </View>

      <Text style={[styles.label, theme.kfont(14.5, { color: theme.tab })]}>{t('linkSection')}</Text>
      <View style={[styles.card, { backgroundColor: theme.card, paddingLeft: 14, paddingRight: 15.5, paddingTop: 18.5, paddingBottom: 14.5 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={theme.kfont(16, { color: theme.text, flex: 1, marginLeft: 2.5 })}>{t('linkShare')}</Text>
          {/* 시안은 스위치가 글자보다 살짝 위 */}
          <View style={{ transform: [{ translateY: -1.5 }] }}>
            <Switch
              label={t('linkShare')}
              value={!!link}
              onChange={(on) =>
                act(() =>
                  on
                    ? sync.shareApi(`/api/folders/${id}/links`, { method: 'POST' })
                    : Promise.all(shares.links.map((l) => sync.shareApi(`/api/folders/${id}/links/${l.token}`, { method: 'DELETE' }))),
                )
              }
            />
          </View>
        </View>
        <Text style={theme.kfont(13.5, { color: theme.subtle, marginTop: 8, marginLeft: 2.5 })}>{link ? t('linkDesc') : t('linkScope', { name })}</Text>
        <Pressable
          disabled={!link}
          accessibilityRole="button"
          onPress={async () => {
            await Clipboard.setStringAsync(linkUrl);
            showToast({ message: t('copied') });
          }}
          style={[styles.secondary, { borderColor: theme.dark ? '#33373D' : theme.outline, backgroundColor: theme.dark ? '#1F2226' : 'transparent', opacity: link ? 1 : 0.5 }]}
        >
          <LinkIcon color={theme.text} size={21} />
          <Text style={theme.kfont(14.5, { color: theme.text, marginLeft: 6.5 })}>{t('copyLink')}</Text>
        </Pressable>
      </View>

      {shares.members.length || link ? (
        <Pressable onPress={() => setConfirmStop(true)} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start', marginLeft: 7, marginTop: -2 }}>
          <Text style={theme.kfont(14.5, { color: theme.danger })}>{t('stopAllSharing')}</Text>
        </Pressable>
      ) : null}

      <Sheet visible={!!roleSheet} onClose={() => setRoleSheet(null)}>
        <SheetTitle title={roleSheet?.member ? roleSheet.member.email || roleSheet.member.name : t('permission')} />
        {(['view', 'edit'] as const).map((r) => (
          <SheetButton
            key={r}
            label={roleLabel(r)}
            selected={(roleSheet?.member ? roleSheet.member.role : role) === r}
            onPress={() => {
              const m = roleSheet?.member;
              setRoleSheet(null);
              if (!m) return setRole(r);
              act(() => sync.shareApi(`/api/folders/${id}/members/${m.user_id}`, { method: 'PATCH', body: JSON.stringify({ role: r }) }));
            }}
          />
        ))}
        {roleSheet?.member ? (
          <SheetButton
            label={t('removeMember')}
            danger
            onPress={() => {
              const m = roleSheet.member!;
              setRoleSheet(null);
              act(() => sync.shareApi(`/api/folders/${id}/members/${m.user_id}`, { method: 'DELETE' }));
            }}
          />
        ) : null}
      </Sheet>
      <ConfirmDialog
        visible={confirmStop}
        title={t('stopAllSharing')}
        body={t('stopAllSharingBody')}
        confirmLabel={t('stopAllSharing')}
        danger
        onClose={() => setConfirmStop(false)}
        onConfirm={() =>
          act(async () => {
            for (const m of shares.members) await sync.shareApi(`/api/folders/${id}/members/${m.user_id}`, { method: 'DELETE' });
            for (const l of shares.links) await sync.shareApi(`/api/folders/${id}/links/${l.token}`, { method: 'DELETE' });
          })
        }
      />
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, marginBottom: 20 },
  input: { borderWidth: 1, borderRadius: 12, height: 44, paddingHorizontal: 16 },
  permRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52.5 },
  roleBtn: { flexDirection: 'row', alignItems: 'center', gap: 2.5 },
  primary: { height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { marginLeft: 7, marginBottom: 8 },
  person: { flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 16, minHeight: 56.5 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 14 },
  secondary: { marginTop: 12.5, height: 42, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
