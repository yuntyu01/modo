import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthCancelled } from '../core/sync';
import { errorText } from '../i18n';
import { makePkce, makeState, openAuth } from '../native/auth';
import { desktop } from '../native/bridge';
import { useApp } from '../state/AppContext';
import { GoogleLoginButton, KakaoLoginButton } from './LoginButtons';
import { Logo } from './Logo';

/**
 * 처음 실행 로그인(서버가 닿을 때만): Google·카카오로 로그인하면 휴대폰·PC가 늘 동기화된다(이메일 로그인은 없앴다).
 * '나중에'는 이번 실행 동안만 넘긴다(다음에 켜면 다시).
 * 서버가 닿지 않으면 이 화면은 나오지 않고 이 기기에서만 쓴다.
 */
export function LoginGate() {
  const { theme, t, sync, serverApi, prefs, account, refreshAccount, deferLogin } = useApp();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const server = account?.server ?? prefs.server;
  const external = async (provider: 'kakao' | 'google') => {
    setBusy(true);
    setError(null);
    try {
      await sync.loginExternal(server, provider, openAuth, await makePkce(), makeState());
      await refreshAccount();
    } catch (e) {
      if (!(e instanceof AuthCancelled)) setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[styles.root, { paddingTop: insets.top + (desktop ? 40 : 0), paddingBottom: insets.bottom + 28 }]}>
      <View style={styles.center}>
        <Logo height={30} color={theme.text} markColor={theme.mark} markRatio={0.83} wordStretch={desktop ? 1 : 1.06} />
        <Text style={theme.kfont(16, { color: theme.muted, marginTop: 22, textAlign: 'center', lineHeight: 24 })}>{t('loginTagline')}</Text>
      </View>
      <View style={styles.actions}>
        {serverApi?.google ? <GoogleLoginButton busy={busy} onPress={() => external('google')} /> : null}
        {serverApi?.kakao ? <KakaoLoginButton busy={busy} onPress={() => external('kakao')} /> : null}
        {error ? <Text style={theme.font(14, { color: theme.danger, textAlign: 'center', marginTop: 4 })}>{error}</Text> : null}
        <Pressable accessibilityRole="button" onPress={deferLogin} hitSlop={10} style={styles.later}>
          <Text style={theme.font(14.5, { color: theme.subtle })}>{t('loginLater')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  actions: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: 10 },
  later: { alignSelf: 'center', paddingVertical: 12 },
});
