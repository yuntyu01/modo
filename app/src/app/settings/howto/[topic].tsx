import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import type { StringKey } from '../../../i18n';
import { native } from '../../../native/bridge';
import { useUi } from '../../../state/AppContext';
import { HOWTO_STEPS, HowToArt, type HowToKind } from '../../../ui/HowToArt';
import { Group, Row } from '../../../ui/primitives';
import { Note, SubScreen } from '../../../ui/SubScreen';

const TITLE: Record<HowToKind, StringKey> = { widget: 'howtoWidget', lock: 'howtoLock' };

/**
 * 홈 화면 위젯·잠금화면 위젯을 직접 넣는 방법(단계마다 그림 + 설명).
 * 앱에서 바로 추가할 수 없는 기기(런처)면 알림 대신 이 화면으로 온다(unsupported=1). 주소: /settings/howto/widget|lock
 */
export default function HowTo() {
  const { theme, t, showToast } = useUi();
  const params = useLocalSearchParams<{ topic?: string; unsupported?: string }>();
  const kind: HowToKind = params.topic === 'lock' ? 'lock' : 'widget';
  const unsupported = params.unsupported === '1';
  const steps = Array.from({ length: HOWTO_STEPS[kind] }, (_, i) => `${TITLE[kind]}${i + 1}` as StringKey);

  const tryAdd = async () => {
    if (!(await native.requestPinWidget())) showToast({ message: t('howtoWidgetUnsupported') });
  };

  return (
    <SubScreen title={t(TITLE[kind])}>
      {unsupported ? <Note>{t('howtoWidgetUnsupported')}</Note> : null}
      {steps.map((key, i) => (
        <View key={key} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 14, padding: 12, marginBottom: 10 }}>
          <HowToArt kind={kind} step={i} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: theme.accent,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 8,
              }}
            >
              <Text style={theme.font(13, { color: theme.onAccent, fontWeight: '700' })}>{i + 1}</Text>
            </View>
            <Text style={theme.kfont(15, { color: theme.text, lineHeight: 22 })}>{t(key)}</Text>
          </View>
        </View>
      ))}
      <Note>{t('howtoVaries')}</Note>
      {kind === 'widget' && !unsupported ? (
        <Group>
          <Row label={t('howtoTryAdd')} onPress={tryAdd} last />
        </Group>
      ) : null}
    </SubScreen>
  );
}
