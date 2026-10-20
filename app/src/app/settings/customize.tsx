import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp, useUi } from '../../state/AppContext';
import { DEFAULT_PREFS, MAIN_ACCENTS, type Prefs } from '../../state/prefs';
import { contrast, hexToRgb, rgbToHsv } from '../../ui/color';
import { homeFolder, liveFolderIds } from '../../ui/home/model';
import { CheckIcon, CheckSquareIcon, ChevronIcon } from '../../ui/Icons';
import { Group, Row, Sheet, SheetButton, Slider, Switch } from '../../ui/primitives';
import { SubScreen } from '../../ui/SubScreen';

/** 미리보기: 지금 폴더의 할 일 한 줄과 그 밑에 입력창(홈 아래쪽 모습). 할 일이 없으면 예시 글. 실제 카드와 같은 모양으로 바로 바뀐다. */
export function Preview() {
  const { snap, theme, t, filter } = useApp();
  const live = liveFolderIds(snap.folders);
  const inView = (f: string | null) => homeFolder(f, live) === filter;
  const todo = snap.todos.find((x) => !x.deleted_at && inView(x.folder_id));
  const inner = theme.dark ? '#1E2126' : theme.bg;
  const right = useApp().prefs.checkSide === 'right';
  const circle = (
    <View style={[styles.pcircle, { backgroundColor: theme.accent, borderColor: theme.accent }, right ? { marginLeft: 18 } : { marginRight: 18 }]}>
      <CheckIcon color={theme.onAccent} size={15} />
    </View>
  );
  return (
    <View pointerEvents="none" style={[styles.preview, { backgroundColor: theme.card }]}>
      <View style={[styles.ptodo, { backgroundColor: inner }]}>
        {!right && circle}
        <Text style={theme.kfont(16, { color: theme.text, flex: 1 })} numberOfLines={1}>
          {todo?.text ?? t('previewTodo')}
        </Text>
        {right && circle}
      </View>
      {/* 다크에서는 입력창이 카드와 거의 같은 색이라 미리보기 안에서는 한 단계 밝게 */}
      <View style={[styles.pinput, { backgroundColor: theme.dark ? '#25282D' : theme.composer }]}>
        <Text style={theme.kfont(15.5, { color: theme.subtle, flex: 1 })} numberOfLines={1}>
          {t('newTodo')}
        </Text>
        <CheckSquareIcon color={theme.accent} size={24} strokeWidth={1.9} />
      </View>
    </View>
  );
}

/** 테마 색상 4개(파랑·차콜·화이트·주황). 고른 색은 흰 테두리 + 체크. 더 많은 꾸미기에서 다른 색을 골랐으면 그 색도 끝에 보여 준다 */
function AccentDots() {
  const { theme, prefs, setPrefs, t } = useUi();
  const current = prefs.accent.toUpperCase();
  const list = MAIN_ACCENTS.includes(current) ? MAIN_ACCENTS : [...MAIN_ACCENTS, current];
  return (
    <View style={[styles.dotsCard, { backgroundColor: theme.card }]}>
      {list.map((c) => {
        const on = prefs.accent.toUpperCase() === c;
        return (
          <Pressable
            key={c}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${t('accentColor')} ${c}`}
            onPress={() => setPrefs({ accent: c })}
            hitSlop={6}
            style={[styles.dotRing, { borderColor: on ? theme.text : 'transparent' }]}
          >
            {/* 카드와 거의 같은 색(라이트의 화이트, 다크의 차콜)도 보이게 옅은 테두리 */}
            <View style={[styles.dot, { backgroundColor: c }, contrast(c, theme.card) < 1.3 && { borderWidth: 1, borderColor: theme.outline }]}>
              {on ? <CheckIcon color={rgbToHsv(hexToRgb(c))[2] > 0.6 ? '#111214' : '#FFFFFF'} size={17} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 화면: 시스템 / 라이트 / 다크 */
function ModeSegment() {
  const { theme, prefs, setPrefs, t } = useUi();
  const opts: { value: Prefs['themeMode']; label: string }[] = [
    { value: 'system', label: t('themeSystem') },
    { value: 'light', label: t('themeLight') },
    { value: 'dark', label: t('themeDark') },
  ];
  return (
    <View style={[styles.segment, { backgroundColor: theme.card }]}>
      {opts.map((o, i) => {
        const on = o.value === prefs.themeMode;
        const sep = i > 0 && !on && opts[i - 1].value !== prefs.themeMode;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => setPrefs({ themeMode: o.value })}
            style={[styles.segItem, on && { backgroundColor: theme.dark ? '#2D3138' : theme.raised }]}
          >
            {sep ? <View style={[styles.segSep, { backgroundColor: theme.dark ? '#2A2E33' : '#D9DCE1' }]} /> : null}
            <Text style={theme.kfont(14.5, { color: on ? theme.text : theme.subtle, fontWeight: on ? '600' : '400', transform: [{ translateY: 1.5 }] })}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 체크 위치: 왼쪽 체크 / 오른쪽 체크 작은 그림 두 개 */
function CheckSide() {
  const { theme, prefs, setPrefs, t } = useUi();
  const tile = (side: Prefs['checkSide']) => {
    const on = prefs.checkSide === side;
    const box = on ? (
      <View style={[styles.miniBox, { backgroundColor: theme.accent, borderColor: theme.accent }]}>
        <CheckIcon color={theme.onAccent} size={10} strokeWidth={3} />
      </View>
    ) : (
      <View style={[styles.miniBox, { borderColor: theme.subtle }]} />
    );
    const lines = (
      <View style={{ gap: 4 }}>
        <View style={[styles.miniLine, { backgroundColor: on ? theme.subtle : theme.muted }]} />
        <View style={[styles.miniLine, { backgroundColor: on ? theme.subtle : theme.muted }]} />
      </View>
    );
    return (
      <Pressable
        key={side}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${t('checkSide')} ${side === 'left' ? '←' : '→'}`}
        onPress={() => setPrefs({ checkSide: side })}
        style={[styles.tile, { borderColor: on ? theme.accent : theme.dark ? '#2C3036' : theme.outline }]}
      >
        {side === 'left' ? box : lines}
        {side === 'left' ? lines : box}
      </Pressable>
    );
  };
  return <View style={{ flexDirection: 'row', gap: 10 }}>{(['left', 'right'] as const).map(tile)}</View>;
}

/** 꾸미기에서 바꾸는 값들(언어·서버·잠금 같은 다른 설정은 그대로 둔다) */
const LOOK_KEYS = ['themeMode', 'accent', 'gradient', 'card', 'checkSide', 'font', 'weight', 'size', 'widget', 'mini', 'logoAccent'] as const;

export default function Customize() {
  const { theme, t, prefs, setPrefs, showToast } = useUi();
  // 기본값으로 되돌리기: 꾸미기(이 화면과 '더 많은 꾸미기')의 값만 처음으로. 바로 '실행 취소'할 수 있다
  const resetLook = () => {
    const before = Object.fromEntries(LOOK_KEYS.map((k) => [k, prefs[k]])) as Partial<Prefs>;
    setPrefs(Object.fromEntries(LOOK_KEYS.map((k) => [k, DEFAULT_PREFS[k]])) as Partial<Prefs>);
    showToast({ message: t('resetDone'), action: { label: t('undo'), run: () => setPrefs(before) } });
  };
  const [sizeSheet, setSizeSheet] = useState(false);
  const sizes: { value: Prefs['size']; label: string }[] = [
    { value: 's', label: t('sizeS') },
    { value: 'm', label: t('sizeM') },
    { value: 'l', label: t('sizeL') },
    { value: 'xl', label: t('sizeXL') },
  ];
  // 위젯·미니창 투명도는 둘을 함께 바꾼다(따로 바꾸려면 '더 많은 꾸미기')
  // 끄는 동안은 화면의 값만 바꾸고, 손을 뗄 때 저장한다(끌 때마다 저장하면 매번 DB에 쓰고 앱 전체를 다시 그린다)
  const [dragOpacity, setDragOpacity] = useState<number | null>(null);
  const opacity = dragOpacity ?? prefs.widget.opacity;
  return (
    <SubScreen title={t('customize')} titleSize={20} titleGap={10} headerShift={-2.5} contentTop={0} padLeft={19}>
      <Preview />
      {/* 테마 색상 줄 오른쪽 끝에 더 많은 꾸미기(색을 직접 고르기·카드색·서체·위젯·미니창) */}
      <View style={styles.labelRow}>
        <Text style={theme.kfont(15, { color: theme.tab, marginLeft: 4, flex: 1 })}>{t('themeColor')}</Text>
        <Pressable onPress={() => router.push('/settings/customize-more')} accessibilityRole="button" hitSlop={8} style={styles.moreLink}>
          <Text style={theme.kfont(14, { color: theme.subtle })}>{t('moreCustomize')}</Text>
          <ChevronIcon color={theme.subtle} size={14} />
        </Pressable>
      </View>
      <View style={{ marginBottom: 21.5 }}>
        <AccentDots />
      </View>
      <Text style={theme.kfont(15, { color: theme.tab, marginLeft: 4, marginBottom: 5 })}>{t('screenMode')}</Text>
      <View style={{ marginBottom: 9.5 }}>
        <ModeSegment />
      </View>
      <Group style={{ marginBottom: 9.5 }} inset={[3, 1]}>
        <Row size="sm" label={t('textSize')} value={sizes.find((x) => x.value === prefs.size)?.label} onPress={() => setSizeSheet(true)} />
        <Row size="sm" label={t('checkSide')} right={<CheckSide />} />
        <Row
          size="sm"
          label={t('bgGradient')}
          right={<Switch size="sm" label={t('bgGradient')} value={prefs.gradient > 0.05} onChange={(on) => setPrefs({ gradient: on ? 0.7 : 0 })} />}
          last
        />
      </Group>
      <View style={[styles.opacityCard, { backgroundColor: theme.card }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={theme.kfont(15.5, { color: theme.text, flex: 1 })}>{t('widgetMiniOpacity')}</Text>
          {/* 이름이 '투명도'라 숫자도 투명한 정도로(저장 값은 불투명도: 예전엔 불투명 80%를 '투명도 80%'로 보여 반대로 읽혔다) */}
          <Text style={theme.kfont(14.5, { color: theme.subtle })}>{Math.round((1 - opacity) * 100)}%</Text>
        </View>
        <Slider
          label={t('widgetMiniOpacity')}
          // 오른쪽으로 밀수록 더 투명(투명도 0~100%: 왼쪽 끝은 배경이 전혀 비치지 않고, 오른쪽 끝은 배경 없이 글자만)
          value={1 - opacity}
          style={{ marginTop: 2.5, marginBottom: -2.5 }}
          onChange={(x) => setDragOpacity(Math.round((1 - x) * 100) / 100)}
          onEnd={(x) => {
            const v = Math.round((1 - x) * 100) / 100;
            setPrefs({ widget: { ...prefs.widget, opacity: v }, mini: { ...prefs.mini, opacity: v } });
            setDragOpacity(null);
          }}
        />
        <Text style={theme.kfont(13, { color: theme.subtle, marginTop: 2 })}>{t('opacityNote')}</Text>
      </View>
      {/* 맨 아래 블록 바로 밑 오른쪽: 기본값으로 되돌리기 */}
      <Pressable onPress={resetLook} accessibilityRole="button" hitSlop={6} style={styles.resetBtn}>
        <Text style={theme.kfont(14, { color: theme.subtle })}>{t('resetDefaults')}</Text>
      </Pressable>

      <Sheet visible={sizeSheet} onClose={() => setSizeSheet(false)}>
        {sizes.map((s) => (
          <SheetButton
            key={s.value}
            label={s.label}
            selected={prefs.size === s.value}
            onPress={() => {
              setSizeSheet(false);
              setPrefs({ size: s.value });
            }}
          />
        ))}
      </Sheet>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  preview: { borderRadius: 16, paddingHorizontal: 18, paddingTop: 14.5, paddingBottom: 16.5, gap: 9, marginBottom: 22.5 },
  ptodo: { borderRadius: 13, minHeight: 55, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15 },
  pcircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  pinput: { borderRadius: 24, minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 13 },
  // 4~5개라 양끝으로 벌리지 않고 시안의 6개 간격(약 23)으로 앞에서부터
  dotsCard: { borderRadius: 14.5, minHeight: 75, flexDirection: 'row', alignItems: 'center', gap: 23, paddingHorizontal: 20.5 },
  dotRing: { width: 37.5, height: 37.5, borderRadius: 18.5, borderWidth: 1.75, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', borderRadius: 18, paddingVertical: 4, paddingHorizontal: 7.5, height: 48 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  segSep: { position: 'absolute', left: 0, top: 12, bottom: 12, width: StyleSheet.hairlineWidth * 2 },
  // 체크 위치 그림: 좌우로 넓게(체크와 줄이 한 줄의 할 일처럼 보이게)
  tile: { width: 66, height: 34, borderRadius: 9, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  miniBox: { width: 11, height: 11, borderRadius: 3, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  miniLine: { width: 26, height: 2, borderRadius: 1 },
  opacityCard: { borderRadius: 14, paddingLeft: 18.5, paddingRight: 18, paddingTop: 19.5, paddingBottom: 15.5, marginBottom: 10 },
  resetBtn: { alignSelf: 'flex-end', paddingHorizontal: 6, paddingVertical: 4, marginBottom: 12 },
  labelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  moreLink: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 8, paddingRight: 2 },
});
