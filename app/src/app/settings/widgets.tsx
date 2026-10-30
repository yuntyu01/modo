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
 * 안드로이드 16+는 크기 판(2×2·4×4·4×1)을 런처·잠금화면의 위젯 고르기에서 빼(삼성 잠금화면에 modo가 4개 나왔다, 사용자 요청 2026-10-30)
 * 크기는 여기서만 고른다(WidgetSizes.kt). 그 아래 안드로이드는 런처 고르기에도 크기별로 보인다.
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
              ['2x2', 'widgetSizeSmall'],
              ['3x3', 'widgetSizeMid'],
              ['4x4', 'widgetSizeLarge'],
              // 한 줄: 폴더 고르기 · 할 일 하나씩
              ['4x1', 'widgetSizeStrip'],
            ] as const
          ).map(([size, label]) => (
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
              <WidgetSizeArt size={size} width={68} />
              <Text style={theme.font(13.5, { color: theme.text, fontWeight: '600', marginTop: 8, textAlign: 'center' })}>{t(label)}</Text>
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
  // 네 크기를 두 줄로(한 줄에 둘)
  sizes: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 18, paddingTop: 6, paddingBottom: 18 },
  size: { flexBasis: '45%', flexGrow: 1, alignItems: 'center', borderRadius: 16, borderWidth: 1, paddingTop: 12, paddingBottom: 10, paddingHorizontal: 4 },
});
