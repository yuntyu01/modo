import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Platform, Text, View } from 'react-native';

import type { StringKey } from '../../i18n';
import { useUi } from '../../state/AppContext';
import { DELETION_URL, POLICY_URL, SUPPORT_URL } from '../../policies';
import { Group, Row } from '../../ui/primitives';
import { Logo } from '../../ui/Logo';
import { Note, SubScreen } from '../../ui/SubScreen';
import { useOpenUrl } from '../../ui/openUrl';

const STEPS = [1, 2, 3, 4, 5, 6, 7].map((n) => [`guide${n}t`, `guide${n}b`] as [StringKey, StringKey]);

export default function Guide() {
  const { theme, t } = useUi();
  const open = useOpenUrl();
  return (
    <SubScreen title={t('help')}>
      {/* 앱 소개: 로고 + 한 줄 소개 + 이름 뜻 */}
      <View style={{ alignItems: 'center', paddingTop: 6, paddingBottom: 22 }}>
        <Logo height={24} color={theme.text} markColor={theme.mark} />
        <Text style={theme.kfont(15, { color: theme.text, marginTop: 12 })}>{t('tagline')}</Text>
        <Text style={theme.kfont(13, { color: theme.subtle, marginTop: 4 })}>
          {t('nameMeaning')} · {Constants.expoConfig?.version ?? ''}
        </Text>
      </View>
      {/* PC 연동: Microsoft Store의 Windows 앱(휴대폰에서만, PC에서는 이미 PC 앱이다) */}
      {Platform.OS !== 'web' ? (
        <Group>
          <Row label={t('pcUse')} onPress={() => router.push('/settings/pc')} last />
        </Group>
      ) : null}
      <Group>
        <Row label={t('privacyPolicy')} onPress={() => open(POLICY_URL)} />
        <Row label={t('requestAccountDeletion')} onPress={() => open(DELETION_URL)} />
        <Row label={t('contactSupport')} onPress={() => open(SUPPORT_URL)} last />
      </Group>
      <Note>{t('targetAudienceNotice')}</Note>
      {STEPS.map(([title, body]) => (
        <View key={title} style={{ backgroundColor: theme.card, borderRadius: 14, padding: 18, marginBottom: 10 }}>
          <Text style={theme.font(16, { color: theme.text, fontWeight: '600', marginBottom: 6 })}>{t(title)}</Text>
          <Text style={theme.font(14, { color: theme.muted, lineHeight: 21 })}>{t(body)}</Text>
        </View>
      ))}
    </SubScreen>
  );
}
