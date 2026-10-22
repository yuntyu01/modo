import { StyleSheet, Text, View } from 'react-native';

import { useUi } from '../../state/AppContext';
import { ACCENTS, CARD_SWATCHES } from '../../state/prefs';
import { Group, Row, Segmented, Slider, Switch } from '../../ui/primitives';
import { SubScreen } from '../../ui/SubScreen';
import { Swatches } from '../../ui/ThemeSwatches';
import { Preview } from './customize';

/**
 * 더 많은 꾸미기(공통): 첫 화면(시안)에 없는 세부 설정. 직접 고르는 테마색, 그라데이션 세기, 카드색, 서체·굵기.
 * 위젯·미니창 테마는 꾸미기 첫 화면의 홈 위젯·잠금 위젯·미니창 탭으로 옮겼다(사용자 요청 2026-10-22).
 */
export default function CustomizeMore() {
  const { theme, t, prefs, setPrefs } = useUi();
  return (
    <SubScreen title={t('moreCustomize')}>
      {/* 맨 위 예시: 꾸미기 첫 화면과 같은 할 일 + 입력창. 여기서 바꾸는 테마색·카드색·서체·굵기가 바로 보인다 */}
      <Preview />
      <Group title={t('accentColor')}>
        <Swatches colors={ACCENTS} value={prefs.accent} onChange={(c) => c && setPrefs({ accent: c })} />
        <View style={{ paddingHorizontal: 20, paddingBottom: 14 }}>
          <Text style={theme.font(14, { color: theme.muted })}>
            {t('gradient')} {Math.round(prefs.gradient * 100)}%
          </Text>
          <Slider label={t('gradient')} value={prefs.gradient} onChange={(gradient) => setPrefs({ gradient })} />
        </View>
        {/* 로고 심볼 색: 켜면(기본) 테마색, 끄면 대표색 */}
        <Row label={t('logoAccent')} right={<Switch label={t('logoAccent')} value={prefs.logoAccent} onChange={(logoAccent) => setPrefs({ logoAccent })} />} last />
      </Group>
      <Group title={t('cardColor')}>
        <Swatches colors={CARD_SWATCHES} value={prefs.card} onChange={(card) => setPrefs({ card })} withDefault />
        <View style={styles.seg}>
          <Text style={theme.font(14, { color: theme.muted, marginBottom: 8 })}>{t('fontFace')}</Text>
          <Segmented
            options={[
              { value: 'system', label: t('fontSystem') },
              { value: 'serif', label: t('fontSerif') },
              { value: 'mono', label: t('fontMono') },
            ]}
            value={prefs.font}
            onChange={(font) => setPrefs({ font })}
          />
        </View>
        <View style={[styles.seg, { paddingBottom: 18 }]}>
          <Text style={theme.font(14, { color: theme.muted, marginBottom: 8 })}>{t('weight')}</Text>
          <Segmented
            options={[
              { value: 'light', label: t('weightLight') },
              { value: 'regular', label: t('weightRegular') },
              { value: 'bold', label: t('weightBold') },
            ]}
            value={prefs.weight}
            onChange={(weight) => setPrefs({ weight })}
          />
        </View>
      </Group>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  seg: { paddingHorizontal: 16, paddingTop: 12 },
});
