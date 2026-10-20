import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { native } from '../../native/bridge';
import { useUi } from '../../state/AppContext';
import type { Prefs } from '../../state/prefs';
import { Group, Row, Segmented, Switch } from '../../ui/primitives';
import { Note, SubScreen } from '../../ui/SubScreen';

/**
 * 잠금화면 알림(메뉴 이름도 '잠금화면'에서 바꿨다, 사용자 요청 2026-10-19): 기기가 잠금화면 위젯을 지원하면 안내하고, 아니면 잠금화면 알림을 대안으로 쓴다.
 * 공개 범위는 사용자가 고르고, 알림의 작업(완료·추가)은 시스템 잠금 해제를 거친다.
 */
export default function Lock() {
  const { t, prefs, setPrefs } = useUi();
  const [support, setSupport] = useState<{ supported: boolean; maybe?: boolean; reason: string } | null>(null);
  const [perm, setPerm] = useState<string>('undetermined');
  useEffect(() => {
    native.lockScreenWidgetSupport().then(setSupport);
    native.notificationPermission().then(setPerm);
  }, []);

  const setLock = async (p: Partial<Prefs['lock']>) => {
    if (p.enabled && perm !== 'granted') {
      const r = await native.requestNotificationPermission();
      setPerm(r);
      if (r !== 'granted') return;
    }
    setPrefs({ lock: { ...prefs.lock, ...p } });
  };

  return (
    <SubScreen title={t('lockNotification')}>
      {Platform.OS === 'ios' ? (
        <Note>{t('lockIos')}</Note>
      ) : (
        <Note>
          {support?.maybe
            ? t('lockMaybe', { reason: support.reason })
            : support?.supported
              ? t('lockSupported', { reason: support.reason })
              : t('lockUnsupported', { reason: support ? ` (${support.reason})` : '' })}
        </Note>
      )}
      {Platform.OS === 'android' && (support?.supported || support?.maybe) ? (
        <Group>
          <Row label={t('howtoLock')} onPress={() => router.push({ pathname: '/settings/howto/[topic]', params: { topic: 'lock' } })} last />
        </Group>
      ) : null}
      {Platform.OS === 'android' ? (
        <>
          <Group>
            <Row
              label={t('lockNotification')}
              right={<Switch label={t('lockNotification')} value={prefs.lock.enabled} onChange={(enabled) => setLock({ enabled })} />}
              last
            />
          </Group>
          {/* 공개 범위는 잠금화면 알림과 잠금화면에 놓인 위젯에 함께 적용 */}
          {prefs.lock.enabled || support?.supported ? (
            <>
              <View style={{ marginBottom: 12 }}>
                <Segmented
                  options={[
                    { value: 'public', label: t('lockPublic') },
                    { value: 'private', label: t('lockPrivate') },
                    { value: 'secret', label: t('lockSecret') },
                  ]}
                  value={prefs.lock.visibility}
                  onChange={(visibility) => setLock({ visibility })}
                />
              </View>
              <Note>{t('lockNote')}</Note>
            </>
          ) : null}
          {perm === 'denied' ? <Note>{t('notifDenied')}</Note> : null}
        </>
      ) : null}
    </SubScreen>
  );
}
