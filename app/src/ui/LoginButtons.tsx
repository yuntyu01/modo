import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { useApp } from '../state/AppContext';
import { GoogleIcon, KakaoIcon } from './Icons';

type Props = { busy: boolean; onPress: () => void };

/**
 * 외부 로그인 버튼: 둘 다 같은 크기·모양(높이 54, 둥글기 18)에 심볼 + 글자.
 * Google은 브랜딩 가이드의 색(라이트: 흰 바탕·회색 테두리, 다크: #131314 바탕)과 네 색 G, 글자는 'Google로 계속하기'처럼 언어마다.
 * (예전엔 Google이 준 영어 이미지 버튼이라 한국어 화면에 'Sign in with Google'이 그대로 나오고 카카오 버튼과 모양이 달랐다)
 */
export function GoogleLoginButton({ busy, onPress }: Props) {
  const { theme, t } = useApp();
  const dark = theme.dark;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('googleLogin')}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: dark ? '#131314' : '#FFFFFF', borderColor: dark ? '#8E918F' : '#747775', borderWidth: 1 },
        { opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={dark ? '#E3E3E3' : '#1F1F1F'} /> : <GoogleIcon size={20} />}
      <Text style={theme.font(16, { color: dark ? '#E3E3E3' : '#1F1F1F', fontWeight: '600' })}>{t('googleLogin')}</Text>
    </Pressable>
  );
}

/** 카카오 디자인 가이드: #FEE500 바탕, 검은 말풍선, 85% 검은 글자 */
export function KakaoLoginButton({ busy, onPress }: Props) {
  const { theme, t } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('kakaoLogin')}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: '#FEE500', opacity: busy ? 0.6 : pressed ? 0.85 : 1 }]}
    >
      {busy ? <ActivityIndicator color="#000000" /> : <KakaoIcon color="#000000" size={20} />}
      <Text style={theme.font(16, { color: 'rgba(0,0,0,0.85)', fontWeight: '600' })}>{t('kakaoLogin')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: 18, alignItems: 'center', justifyContent: 'center', height: 54, flexDirection: 'row', gap: 8 },
});
