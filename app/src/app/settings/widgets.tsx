import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { native } from '../../native/bridge';
import { useUi } from '../../state/AppContext';
import { WidgetSizeArt } from '../../ui/HowToArt';
import { Group, Row, Sheet, SheetTitle } from '../../ui/primitives';
import { Note, SubScreen } from '../../ui/SubScreen';

/**
 * 홈·잠금화면(Android): 위는 '자동'(누르면 시스템이 바로 넣어 준다), 아래는 '수동'(그림으로 보는 직접 넣는 방법).
 * 빠른 설정 타일·'빠른 추가' 앱 아이콘은 뺐다(사용자 요청 2026-10-21. 위젯 +와 잠금화면 알림의 입력줄은 그대로).
 * 두 묶음의 항목 이름을 같게 해서 같은 것을 어떻게 넣는지만 고르게 했다. 긴 회색 설명은 뺐다(사용자 요청 2026-10-19).
 * 위젯을 자동으로 넣으면 먼저 크기(3×3·4×4)를 고르고, 앱을 내리고 홈 화면으로 가서 놓인 위젯을 보여 준다(ModoNativeModule requestPinWidget).
 * 런처의 위젯 고르기 화면에도 두 크기가 따로 보인다(WidgetSizes.kt).
 */
export default function Widgets() {
  const { t, theme } = useUi();
  const [sizes, setSizes] = useState(false);
  if (Platform.OS === 'ios') {
    return (
      <SubScreen title={t('widgets')}>
        <Note>{t('widgetsIos')}</Note>
      </SubScreen>
    );
  }
  const howto = (topic: 'widget' | 'lock') => router.push({ pathname: '/settings/howto/[topic]', params: { topic } });
  return (
    <SubScreen title={t('widgets')}>
      <Group title={t('widgetAuto')}>
        {/* 바로 추가가 안 되는 런처·기기면 그림으로 보는 '직접 넣는 방법'으로 */}
        <Row label={t('homeWidget')} onPress={() => setSizes(true)} last />
      </Group>
      <Group title={t('widgetManual')}>
        <Row label={t('homeWidget')} onPress={() => howto('widget')} />
        <Row label={t('lockWidget')} onPress={() => howto('lock')} last />
      </Group>
      <Sheet visible={sizes} onClose={() => setSizes(false)}>
        <SheetTitle title={t('widgetSize')} />
        {/* 크기마다 홈 화면에서 차지하는 모습을 그림으로(사용자 요청 2026-10-21) */}
        <View style={styles.sizes}>
          {(
            [
              [3, '3x3', 'widgetSizeMid'],
              [4, '4x4', 'widgetSizeLarge'],
            ] as const
          ).map(([cells, size, label]) => (
            <Pressable
              key={size}
              accessibilityRole="button"
              accessibilityLabel={t(label)}
              onPress={async () => {
                setSizes(false);
                if (!(await native.requestPinWidget(size))) router.push({ pathname: '/settings/howto/[topic]', params: { topic: 'widget', unsupported: '1' } });
              }}
              style={({ pressed }) => [styles.size, { borderColor: theme.outline }, pressed && { backgroundColor: theme.raised }]}
            >
              <WidgetSizeArt cells={cells} />
              <Text style={theme.font(15, { color: theme.text, fontWeight: '600', marginTop: 10 })}>{t(label)}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
      {/* 잠금화면 알림과 공개 범위 */}
      <Group>
        <Row label={t('lockNotification')} onPress={() => router.push('/settings/lock')} last />
      </Group>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  sizes: { flexDirection: 'row', gap: 12, paddingHorizontal: 22, paddingTop: 6, paddingBottom: 18 },
  size: { flex: 1, alignItems: 'center', borderRadius: 16, borderWidth: 1, paddingTop: 16, paddingBottom: 14 },
});
