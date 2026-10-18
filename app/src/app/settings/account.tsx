import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthCancelled } from '../../core/sync';
import { DELETION_URL, POLICY_URL } from '../../policies';
import { codeText, errorText, resolveLang } from '../../i18n';
import { makePkce, makeState, openAuth } from '../../native/auth';
import { desktop } from '../../native/bridge';
import { GoogleLoginButton, KakaoLoginButton } from '../../ui/LoginButtons';
import { useApp, useSyncStatus } from '../../state/AppContext';
import { formatDateTime } from '../../ui/format';
import { ConfirmDialog, Group, Row } from '../../ui/primitives';
import { Note, SubScreen } from '../../ui/SubScreen';
import { inputColors } from '../../ui/theme';
import { DEFAULT_SERVER } from '../../state/prefs';

export default function Account() {
  const { theme, t, account, sync, prefs, setPrefs, refreshAccount, deleteAccount, showToast } = useApp();
  const status = useSyncStatus();
  const lang = resolveLang(prefs.language);
  const [server, setServer] = useState(process.env.NODE_ENV === 'production' ? DEFAULT_SERVER : prefs.server);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmDeletion, setConfirmDeletion] = useState(false);
  const [kakao, setKakao] = useState(false);
  const [google, setGoogle] = useState(false);
  const open = (url: string) => Linking.openURL(url).catch(() => showToast({ message: t('linkOpenFailed') }));
  const policyLinks = (
    <Group>
      <Row label={t('privacyPolicy')} onPress={() => open(POLICY_URL)} />
      <Row label={t('requestAccountDeletion')} danger onPress={() => open(DELETION_URL)} last />
    </Group>
  );

  // 서버 주소를 고치면 그 서버가 Google·카카오 로그인을 켜 두었는지 다시 묻는다(잠깐 멈춘 뒤)
  useEffect(() => {
    if (account) return;
    let alive = true;
    const timer = setTimeout(() => {
      sync
        .providers(server.trim())
        .then((p) => { if (alive) { setKakao(!!p.kakao); setGoogle(!!p.google); } })
        .catch(() => { if (alive) { setKakao(false); setGoogle(false); } });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [server, account, sync]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      setPrefs({ server: server.trim() });
      await fn();
      await refreshAccount();
    } catch (e) {
      if (!(e instanceof AuthCancelled)) setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  const kakaoLogin = () => run(async () => sync.loginExternal(server.trim(), 'kakao', openAuth, await makePkce(), makeState()));
  const googleLogin = () => run(async () => sync.loginExternal(server.trim(), 'google', openAuth, await makePkce(), makeState()));

  const field = (value: string, onChange: (v: string) => void, placeholder: string, opts: object = {}) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={theme.muted}
      autoCapitalize="none"
      autoCorrect={false}
      {...inputColors(theme)}
      style={[
        styles.field,
        theme.font(16, { color: theme.text }),
        { backgroundColor: theme.card },
        Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
      ]}
      {...opts}
    />
  );

  const stateText = {
    local: t('notSignedIn'),
    idle: t('syncIdle'),
    syncing: t('syncing'),
    offline: t('syncOffline'),
    error: `${t('syncError')}: ${codeText(status.code, status.message ?? '', t)}`,
    expired: t('syncExpired'),
  }[status.state];

  if (account) {
    return (
      <SubScreen title={t('account')}>
        <Group>
          <Row label={account.email ? t('email') : t('account')} value={account.email || account.name || ''} />
          <Row label={t('server')} value={account.server} />
          <Row label={stateText} right={status.state === 'syncing' ? <ActivityIndicator color={theme.muted} /> : <View />} />
          {status.lastSyncAt ? <Row label={t('lastSync', { time: formatDateTime(status.lastSyncAt, lang) })} right={<View />} /> : null}
          {status.pending ? <Row label={t('pendingChanges', { n: status.pending })} right={<View />} /> : null}
          {status.rejected ? <Row label={t('rejected', { n: status.rejected })} right={<View />} /> : null}
          <Row label={t('syncNow')} onPress={() => sync.syncNow().then(() => showToast({ message: t('syncIdle') }))} last />
        </Group>
        <Note>{t('accountSignedIn')}</Note>
        {policyLinks}
        <Group>
          {Platform.OS !== 'web' || desktop ? <Row label={t('deleteAccount')} danger onPress={busy ? undefined : () => setConfirmDeletion(true)} /> : null}
          <Row label={t('logout')} danger onPress={busy ? undefined : () => setConfirmLogout(true)} last />
        </Group>
        {busy ? <ActivityIndicator color={theme.accent} /> : null}
        {error ? <Text style={theme.font(14, { color: theme.danger })}>{error}</Text> : null}
        <ConfirmDialog
          visible={confirmDeletion}
          title={t('deleteAccount')}
          body={t('deleteAccountBody')}
          confirmLabel={t('deleteAccount')}
          danger
          onConfirm={async () => {
            setBusy(true); setError(null);
            try { await deleteAccount(); showToast({ message: t('accountDeletionAccepted') }); }
            catch (e) { setError(errorText(e, t)); }
            finally { setBusy(false); }
          }}
          onClose={() => setConfirmDeletion(false)}
        />
        <ConfirmDialog
          visible={confirmLogout}
          title={t('logout')}
          body={t('logoutBody')}
          confirmLabel={t('logout')}
          danger
          onConfirm={async () => {
            await sync.logout();
            await refreshAccount();
          }}
          onClose={() => setConfirmLogout(false)}
        />
      </SubScreen>
    );
  }

  return (
    <SubScreen title={t('account')}>
      <Note>{t('accountSignedOut')}</Note>
      <Note>{t('targetAudienceNotice')}</Note>
      {policyLinks}
      {/* 로그인은 Google·카카오만(이메일 로그인은 없앴다). 서버가 둘 다 꺼 두었거나 닿지 않으면 안내만 */}
      <View style={styles.logins}>
        {google ? <GoogleLoginButton busy={busy} onPress={googleLogin} /> : null}
        {kakao ? <KakaoLoginButton busy={busy} onPress={kakaoLogin} /> : null}
        {!google && !kakao ? <Note>{t('loginUnavailable')}</Note> : null}
      </View>
      {process.env.NODE_ENV !== 'production' ? field(server, setServer, t('server'), { keyboardType: 'url' }) : null}
      {error ? <Text style={theme.font(14, { color: theme.danger, marginHorizontal: 8, marginBottom: 10 })}>{error}</Text> : null}
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  field: { borderRadius: 14, paddingHorizontal: 18, paddingVertical: 15, marginBottom: 10 },
  logins: { gap: 10, marginBottom: 14 },
});
