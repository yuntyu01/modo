import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useUi } from '../state/AppContext';
import { contrast, hexToRgb, hsvToRgb, isHex, rgbToHex, rgbToHsv } from './color';
import { CheckIcon } from './Icons';
import { Slider } from './primitives';
import { inputColors } from './theme';

/** 색 고르기 동그라미 줄(+ 무지개 = 직접 고르기). withDefault: 맨 앞에 '기본'(null). 꾸미기 탭과 더 많은 꾸미기가 함께 쓴다 */
export function Swatches({
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
  const { theme, t } = useUi();
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
  const { theme, t } = useUi();
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

const styles = StyleSheet.create({
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  dot: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  customInner: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#FFF' },
  hueBar: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 2 },
  hex: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginTop: 8, width: 140 },
});
