import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { CodedError } from '../core/errors';
import type { AuthBrowser, Pkce } from '../core/sync';
import { desktop } from './bridge';

const base64url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function randomString(bytes: number) {
  const raw = Crypto.getRandomBytes(bytes);
  let bin = '';
  for (const b of raw) bin += String.fromCharCode(b);
  return base64url(btoa(bin));
}

/** PKCE(S256): verifier는 이 기기에만, challenge만 서버로 */
export async function makePkce(): Promise<Pkce> {
  const verifier = randomString(32);
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return { verifier, challenge: base64url(digest) };
}

export const makeState = () => randomString(16);

/**
 * 로그인 페이지 열기. 휴대폰은 시스템 인증 브라우저(iOS ASWebAuthenticationSession, Android Custom Tabs),
 * 데스크톱은 Electron 창(desktop/main.cjs openAuth)이 modo://auth 로 돌아오는 순간을 잡는다.
 */
export const openAuth: AuthBrowser = async (url, redirect) => {
  if (Platform.OS === 'web') {
    if (!desktop?.openAuth) throw new CodedError('kakao_unavailable', '이 환경에서는 카카오 로그인을 열 수 없어요');
    return desktop.openAuth(url, redirect);
  }
  const r = await WebBrowser.openAuthSessionAsync(url, redirect);
  return r.type === 'success' ? r.url : null;
};
