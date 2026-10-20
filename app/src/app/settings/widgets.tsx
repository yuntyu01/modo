import { router } from 'expo-router';
import { Platform } from 'react-native';

import { native } from '../../native/bridge';
import { useUi } from '../../state/AppContext';
import { Group, Row } from '../../ui/primitives';
import { Note, SubScreen } from '../../ui/SubScreen';

/**
 * 홈·잠금화면(Android): 위는 '자동'(누르면 시스템이 바로 넣어 준다), 아래는 '수동'(그림으로 보는 직접 넣는 방법).
 * 두 묶음의 항목 이름을 같게 해서 같은 것을 어떻게 넣는지만 고르게 했다. 긴 회색 설명은 뺐다(사용자 요청 2026-10-19).
 * 위젯을 자동으로 넣으면 앱을 내리고 홈 화면으로 가서 놓인 위젯을 보여 준다(ModoNativeModule requestPinWidget).
 */
export default function Widgets() {
  const { t, showToast } = useUi();
  if (Platform.OS === 'ios') {
    return (
      <SubScreen title={t('widgets')}>
        <Note>{t('widgetsIos')}</Note>
      </SubScreen>
    );
  }
  const howto = (topic: 'widget' | 'tile' | 'lock') => router.push({ pathname: '/settings/howto/[topic]', params: { topic } });
  return (
    <SubScreen title={t('widgets')}>
      <Group title={t('widgetAuto')}>
        {/* 바로 추가가 안 되는 런처·기기면 그림으로 보는 '직접 넣는 방법'으로 */}
        <Row
          label={t('homeWidget')}
          onPress={async () => {
            if (!(await native.requestPinWidget())) router.push({ pathname: '/settings/howto/[topic]', params: { topic: 'widget', unsupported: '1' } });
          }}
        />
        <Row
          label={t('quickTile')}
          onPress={async () => {
            const r = await native.requestAddTile();
            if (r === 'unsupported') return router.push({ pathname: '/settings/howto/[topic]', params: { topic: 'tile', unsupported: '1' } });
            const key = { added: 'tileAdded', already: 'tileAlready', dismissed: 'tileDismissed' } as const;
            showToast({ message: t(key[r]) });
          }}
          last
        />
      </Group>
      <Group title={t('widgetManual')}>
        <Row label={t('homeWidget')} onPress={() => howto('widget')} />
        <Row label={t('quickTile')} onPress={() => howto('tile')} />
        <Row label={t('lockWidget')} onPress={() => howto('lock')} last />
      </Group>
      {/* 잠금화면 알림과 공개 범위 */}
      <Group>
        <Row label={t('lockNotification')} onPress={() => router.push('/settings/lock')} last />
      </Group>
    </SubScreen>
  );
}
