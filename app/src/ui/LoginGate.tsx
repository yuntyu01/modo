import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthCancelled } from '../core/sync';
import { errorText } from '../i18n';
import { makePkce, makeState, openAuth } from '../native/auth';
import { desktop } from '../native/bridge';
import { useApp } from '../state/AppContext';
import { GoogleLoginButton, KakaoLoginButton } from './LoginButtons';
import { Logo } from './Logo';
import { Sheet, SheetButton, SheetTitle } from './primitives';

/**
 * 로그인 화면: 로그인하지 않았으면 무조건 이 화면부터(Google·카카오. 이메일 로그인과 '나중에'는 없앴다, 사용자 요청 2026-10-19).
 * 로그인하면 휴대폰·PC가 늘 동기화된다. 로그인한 뒤에는 인터넷이 없어도 이 기기에서 그대로 쓰고, 연결되면 쌓인 변경을 올린다.
 * 서버에 닿지 않으면(인터넷 없음) 연결하라는 글과 다시 시도. 1분마다·앱으로 돌아올 때도 다시 묻는다(AppContext).
 * 기록이 있는 계정(다시 설치·다른 기기)은 첫 실행 화면(테마색·첫 할 일)을 건너뛰고, 새 계정이면 로그인 뒤에 그 화면이 나온다.
 */
export function LoginGate({ expired = false }: { expired?: boolean }) {
  const { theme, t, sync, repo, serverApi, serverChecked, recheckServer, prefs, setPrefs, account, refreshAccount } = useApp();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewEmail, setReviewEmail] = useState('');
  const [reviewPassword, setReviewPassword] = useState('');
  const server = account?.server ?? prefs.server;
  const external = async (provider: 'kakao' | 'google') => {
    setBusy(true);
    setError(null);
    try {
      await sync.loginExternal(server, provider, openAuth, await makePkce(), makeState());
      const s = await repo.snapshot();
      if (s.todos.length || s.paragraphs.length) setPrefs({ onboarded: true });
      await refreshAccount();
    } catch (e) {
      if (!(e instanceof AuthCancelled)) setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    setChecking(true);
    await recheckServer();
    setChecking(false);
  };
  const reviewLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await sync.login(server, reviewEmail, reviewPassword, false, true);
      setReviewPassword('');
      setReviewOpen(false);
      const snapshot = await repo.snapshot();
      if (snapshot.todos.length || snapshot.paragraphs.length) setPrefs({ onboarded: true });
      await refreshAccount();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  const canLogin = !!serverApi && (serverApi.google || serverApi.kakao);
  return (
    <View style={[styles.root, { paddingTop: insets.top + (desktop ? 40 : 0), paddingBottom: insets.bottom + 28 }]}>
      <View style={styles.center}>
        <Logo height={30} color={theme.text} markColor={theme.mark} markRatio={0.83} wordStretch={desktop ? 1 : 1.06} />
        <Text style={theme.kfont(16, { color: theme.muted, marginTop: 22, textAlign: 'center', lineHeight: 24 })}>
          {expired ? t('err_session_expired') : t('loginTagline')}
        </Text>
        {/* 만료면 어느 계정이었는지(다른 계정으로 들어오면 이 기기의 기록이 그 계정으로 올라간다) */}
        {expired && account?.email ? (
          <Text style={theme.font(14, { color: theme.subtle, marginTop: 6, textAlign: 'center' })}>{account.email}</Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        {canLogin ? (
          <>
            {serverApi.google ? <GoogleLoginButton busy={busy} onPress={() => external('google')} /> : null}
            {serverApi.kakao ? <KakaoLoginButton busy={busy} onPress={() => external('kakao')} /> : null}
            {error ? <Text style={theme.font(14, { color: theme.danger, textAlign: 'center', marginTop: 4 })}>{error}</Text> : null}
          </>
        ) : !serverChecked || checking ? (
          <ActivityIndicator color={theme.subtle} style={styles.wait} />
        ) : (
          <>
            {/* 서버가 답은 하는데 켜 둔 로그인 수단이 없으면(서버 설정 문제) 서버 오류로 */}
            <Text style={theme.kfont(15, { color: theme.muted, textAlign: 'center' })}>{t(serverApi ? 'err_server' : 'loginOffline')}</Text>
            <Pressable accessibilityRole="button" onPress={retry} hitSlop={10} style={styles.retry}>
              <Text style={theme.font(15, { color: theme.accent, fontWeight: '600' })}>{t('loginRetry')}</Text>
            </Pressable>
          </>
        )}
        {Platform.OS === 'android' && serverApi?.storeReview ? (
          <Pressable accessibilityRole="button" onPress={() => { setError(null); setReviewOpen(true); }} disabled={busy} style={styles.retry}>
            <Text style={theme.font(12, { color: theme.muted })}>Store review account</Text>
          </Pressable>
        ) : null}
      </View>
      <Sheet visible={reviewOpen} onClose={() => { if (!busy) { setReviewOpen(false); setReviewPassword(''); } }}>
        <SheetTitle title="Store review account" subtitle="For the existing store-review account only. Other users should choose Google or Kakao." />
        <View style={{ paddingHorizontal: 22, gap: 12 }}>
          <TextInput accessibilityLabel="Review account email" placeholder="Email" placeholderTextColor={theme.muted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={reviewEmail} onChangeText={setReviewEmail} editable={!busy} style={[theme.font(16, { color: theme.text }), { padding: 12, borderWidth: 1, borderColor: theme.muted, borderRadius: 12 }]} />
          <TextInput accessibilityLabel="Review account password" placeholder="Password" placeholderTextColor={theme.muted} secureTextEntry autoCapitalize="none" autoCorrect={false} value={reviewPassword} onChangeText={setReviewPassword} editable={!busy} style={[theme.font(16, { color: theme.text }), { padding: 12, borderWidth: 1, borderColor: theme.muted, borderRadius: 12 }]} />
          {error ? <Text style={theme.font(14, { color: theme.danger })}>{error}</Text> : null}
        </View>
        <SheetButton label={busy ? 'Signing in…' : 'Sign in'} disabled={busy || !reviewEmail.trim() || !reviewPassword} onPress={reviewLogin} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  actions: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: 10, minHeight: 116, justifyContent: 'flex-end' },
  wait: { paddingVertical: 12 },
  retry: { alignSelf: 'center', paddingVertical: 12 },
});
