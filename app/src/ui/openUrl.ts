import { useCallback } from 'react';
import { Linking } from 'react-native';

import { useUi } from '../state/AppContext';

/** 바깥 주소 열기. 못 열면 토스트(내 계정·도움말이 같은 것을 따로 갖고 있었다) */
export function useOpenUrl() {
  const { showToast, t } = useUi();
  return useCallback((url: string) => Linking.openURL(url).catch(() => showToast({ message: t('linkOpenFailed') })), [showToast, t]);
}
