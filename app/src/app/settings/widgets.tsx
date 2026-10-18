import { router } from 'expo-router';
import { Platform } from 'react-native';

import { native } from '../../native/bridge';
import { useApp } from '../../state/AppContext';
import { Group, Row } from '../../ui/primitives';
import { Note, SubScreen } from '../../ui/SubScreen';

export default function Widgets() {
  const { t, showToast } = useApp();
  if (Platform.OS === 'ios') {
    return (
      <SubScreen title={t('widgets')}>
        <Note>{t('widgetsIos')}</Note>
      </SubScreen>
    );
  }
  return (
    <SubScreen title={t('widgets')}>
      <Note>{t('widgetsAndroid')}</Note>
      <Group>
        {/* 바로 추가가 안 되는 런처·기기면 알림 대신 그림으로 보는 '직접 넣는 방법'으로 */}
        <Row
          label={t('addWidget')}
          onPress={async () => {
            if (!(await native.requestPinWidget())) router.push({ pathname: '/settings/howto/[topic]', params: { topic: 'widget', unsupported: '1' } });
          }}
        />
        <Row
          label={t('addTile')}
          onPress={async () => {
            const r = await native.requestAddTile();
            if (r === 'unsupported') return router.push({ pathname: '/settings/howto/[topic]', params: { topic: 'tile', unsupported: '1' } });
            const key = { added: 'tileAdded', already: 'tileAlready', dismissed: 'tileDismissed' } as const;
            showToast({ message: t(key[r]) });
          }}
        />
        <Row label={t('lockScreen')} onPress={() => router.push('/settings/lock')} last />
      </Group>
      <Group title={t('howtoGroup')}>
        <Row label={t('howtoWidget')} onPress={() => router.push({ pathname: '/settings/howto/[topic]', params: { topic: 'widget' } })} />
        <Row label={t('howtoTile')} onPress={() => router.push({ pathname: '/settings/howto/[topic]', params: { topic: 'tile' } })} />
        <Row label={t('howtoLock')} onPress={() => router.push({ pathname: '/settings/howto/[topic]', params: { topic: 'lock' } })} last />
      </Group>
      <Note>{t('widgetsNote')}</Note>
    </SubScreen>
  );
}
