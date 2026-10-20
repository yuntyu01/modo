import { Text, View } from 'react-native';

import { useUi } from '../../state/AppContext';
import { WINDOWS_STORE_URL } from '../../policies';
import { Group, Row } from '../../ui/primitives';
import { shareText } from '../../ui/share';
import { Note, SubScreen } from '../../ui/SubScreen';

const STEPS = ['pcStep1', 'pcStep2', 'pcStep3'] as const;

/**
 * PC에서도 쓰기(도움말): Windows용 modo는 Microsoft Store에서 받아 같은 계정으로 로그인하면 휴대폰과 저절로 맞춰진다.
 * 휴대폰에서는 Windows 앱을 설치할 수 없어서, 스토어 링크를 PC로 보내는 버튼을 둔다(카카오톡·메일 등 공유, 안 되면 복사)
 */
export default function PcGuide() {
  const { theme, t, showToast } = useUi();
  return (
    <SubScreen title={t('pcUse')}>
      <Text style={theme.kfont(15.5, { color: theme.subtle, marginLeft: 6.5, marginTop: -5, marginBottom: 16, lineHeight: 22 })}>{t('pcIntro')}</Text>
      {STEPS.map((key, i) => (
        <View key={key} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 14, padding: 16, marginBottom: 10 }}>
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: theme.raised, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
            <Text style={theme.font(13.5, { color: theme.text, fontWeight: '700' })}>{i + 1}</Text>
          </View>
          <Text style={theme.kfont(15, { color: theme.text, lineHeight: 22, flex: 1 })}>{t(key)}</Text>
        </View>
      ))}
      <Group style={{ marginTop: 10 }}>
        <Row
          label={t('pcStoreLink')}
          onPress={async () => {
            if ((await shareText(`modo for Windows\n${WINDOWS_STORE_URL}`)) === 'copied') showToast({ message: t('copied') });
          }}
          last
        />
      </Group>
      <Note>{t('pcNote')}</Note>
    </SubScreen>
  );
}
