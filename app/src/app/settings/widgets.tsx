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
        <Row
          label={t('addWidget')}
          onPress={async () => {
            if (!(await native.requestPinWidget())) showToast({ message: t('pinUnsupported') });
          }}
        />
        <Row
          label={t('addTile')}
          onPress={async () => {
            const r = await native.requestAddTile();
            const key = { added: 'tileAdded', already: 'tileAlready', dismissed: 'tileDismissed', unsupported: 'tileManual' } as const;
            showToast({ message: t(key[r]) });
          }}
        />
        <Row label={t('lockScreen')} onPress={() => router.push('/settings/lock')} last />
      </Group>
      <Note>{t('widgetsNote')}</Note>
    </SubScreen>
  );
}
