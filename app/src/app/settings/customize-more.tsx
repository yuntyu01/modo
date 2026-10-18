import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useApp } from '../../state/AppContext';
import { ACCENTS, CARD_SWATCHES, type SurfaceTheme } from '../../state/prefs';
import { contrast, hexToRgb, hsvToRgb, isHex, rgbToHex, rgbToHsv } from '../../ui/color';
import { CheckIcon } from '../../ui/Icons';
import { Group, Row, Segmented, Slider, Switch } from '../../ui/primitives';
import { SubScreen } from '../../ui/SubScreen';
import { inputColors } from '../../ui/theme';
import { Preview } from './customize';

function Swatches({
  colors,
  value,
  onChange,
  withDefault,
}: {
  colors: string[];
  value: string | null;
  onChange: (c: string | null) => void;
  withDefault?: boolean;
}) {
  const { theme, t } = useApp();
  const [custom, setCustom] = useState(false);
  const isCustom = !!value && !colors.includes(value);
  const dot = (c: string | null, key: string, label: string) => {
    const on = value === c;
    return (
      <Pressable
        key={key}
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={{ selected: on }}
        onPress={() => onChange(c)}
        style={[
          styles.dot,
          // 카드와 거의 같은 색(라이트의 흰색, 다크의 검정)도 보이게 옅은 테두리
          { backgroundColor: c ?? theme.card, borderColor: on ? theme.text : c && contrast(c, theme.card) < 1.3 ? theme.outline : 'transparent' },
          c === null && { borderColor: on ? theme.text : theme.outline, borderStyle: 'dashed' },
        ]}
      >
        {on ? <CheckIcon color={c && rgbToHsv(hexToRgb(c))[2] > 0.75 ? '#111' : '#FFF'} size={18} /> : null}
      </Pressable>
    );
  };
  return (
    <View style={{ padding: 16 }}>
      <View style={styles.swatches}>
        {withDefault ? dot(null, 'default', t('fontSystem')) : null}
        {colors.map((c) => dot(c, c, c))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('custom')}
          onPress={() => setCustom(!custom)}
          style={[styles.dot, { borderColor: isCustom ? theme.text : 'transparent', overflow: 'hidden' }]}
        >
          <LinearGradient colors={['#FF5F6D', '#FFC371', '#5FD38D', '#4FA3FF', '#B79CFF', '#FF5F6D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          {isCustom ? <View style={[styles.customInner, { backgroundColor: value! }]} /> : null}
        </Pressable>
      </View>
      {custom ? <CustomColor value={value ?? colors[0]} onChange={onChange} /> : null}
    </View>
  );
}

/** 사용자 지정 색: 색상 슬라이더 + 밝기 슬라이더 + HEX 입력 */
function CustomColor({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const { theme, t } = useApp();
  const [h, s, v] = rgbToHsv(hexToRgb(value));
  const [hex, setHex] = useState(value);
  const set = (c: string) => {
    setHex(c);
    onChange(c);
  };
  return (
    <View style={{ marginTop: 14 }}>
      <View style={styles.hueBar}>
        <LinearGradient
          colors={['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <Slider label={t('custom')} value={h / 360} onChange={(x) => set(rgbToHex(hsvToRgb(x * 359, Math.max(s, 0.35), Math.max(v, 0.5))))} />
      <Slider label={t('custom')} value={v} onChange={(x) => set(rgbToHex(hsvToRgb(h, Math.max(s, 0.2), Math.max(0.15, x))))} />
      <TextInput
        value={hex}
        onChangeText={(x) => {
          setHex(x);
          if (isHex(x)) onChange(x.startsWith('#') ? x.toUpperCase() : `#${x.toUpperCase()}`);
        }}
        autoCapitalize="characters"
        maxLength={7}
        {...inputColors(theme)}
        style={[
          styles.hex,
          theme.font(15, { color: theme.text }),
          { backgroundColor: theme.dark ? '#111214' : '#F1F2F4' },
          Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
        ]}
      />
    </View>
  );
}

function SurfaceSettings({ title, value, onChange }: { title: string; value: SurfaceTheme; onChange: (v: SurfaceTheme) => void }) {
  const { theme, t } = useApp();
  return (
    <Group title={title}>
      <Row label={t('followApp')} right={<Switch label={t('followApp')} value={value.linked} onChange={(linked) => onChange({ ...value, linked })} />} />
      {!value.linked ? (
        <>
          <Text style={theme.font(14, { color: theme.muted, marginLeft: 20, marginTop: 12 })}>{t('accentColor')}</Text>
          <Swatches colors={ACCENTS} value={value.accent} onChange={(c) => c && onChange({ ...value, accent: c })} />
          <Text style={theme.font(14, { color: theme.muted, marginLeft: 20 })}>{t('cardColor')}</Text>
          <Swatches colors={CARD_SWATCHES} value={value.card} onChange={(card) => onChange({ ...value, card })} withDefault />
        </>
      ) : null}
      <View style={{ paddingHorizontal: 20, paddingBottom: 14, paddingTop: 10 }}>
        <Text style={theme.font(14, { color: theme.muted })}>
          {t('bgOpacity')} {Math.round(value.opacity * 100)}%
        </Text>
        <Slider label={t('bgOpacity')} value={value.opacity} onChange={(opacity) => onChange({ ...value, opacity: Math.max(0.2, opacity) })} />
      </View>
    </Group>
  );
}

/** 더 많은 꾸미기: 첫 화면(시안)에 없는 세부 설정. 직접 고르는 테마색, 그라데이션 세기, 카드색, 서체·굵기, 위젯·미니창 개별 테마. */
export default function CustomizeMore() {
  const { theme, t, prefs, setPrefs } = useApp();
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
      <SurfaceSettings title={t('widgetTheme')} value={prefs.widget} onChange={(widget) => setPrefs({ widget })} />
      <SurfaceSettings title={t('miniTheme')} value={prefs.mini} onChange={(mini) => setPrefs({ mini })} />
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  dot: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  customInner: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#FFF' },
  hueBar: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 2 },
  hex: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginTop: 8, width: 140 },
  sides: { flexDirection: 'row', gap: 12, padding: 16 },
  sideCard: { flex: 1, height: 58, borderRadius: 16, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 },
  miniCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  miniLine: { flex: 1, height: 8, borderRadius: 4 },
  seg: { paddingHorizontal: 16, paddingTop: 12 },
});
