import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LANG_NAMES } from '../../i18n';
import { useApp, useSyncStatus } from '../../state/AppContext';
import { HomeHeader } from '../../ui/home/Header';
import { BoxIcon, ChevronIcon, GlobeIcon, HelpIcon, LockIcon, MonitorIcon, PersonCircleIcon, SlidersIcon, TrashIcon, WidgetBoxIcon } from '../../ui/Icons';
import { BottomFade } from '../../ui/glass';
import { contrast } from '../../ui/color';
import { useBottomInset, useWide } from '../../ui/layout';
import { Dropdown } from '../../ui/Dropdown';
import { Group, Row, Switch } from '../../ui/primitives';
import { loadPopular, recommendedAccents, withCurrent } from '../../state/popularThemes';
import { localDate } from '../../ui/format';
import { countTrash } from '../../ui/home/model';

/**
 * 설정(시안): 로고 머리 → '설정' → 내 계정 카드 → 화면과 위젯 → 할 일 → 언어·도움말.
 * 시안에 없는 휴지통·백업·잠금화면은 없애지 않고 위쪽 ⋯ 메뉴에 둔다.
 */
export default function More() {
  const { theme, t, prefs, setPrefs, account, snap, serverApi } = useApp();
  const status = useSyncStatus();
  const { compact } = useWide();
  const navInset = useBottomInset();
  const [menu, setMenu] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<View | null>(null);
  // 시안: 줄 아이콘은 글자 높이쯤(언어·도움말 동그라미 아이콘은 조금 크다)
  const ic = (I: typeof GlobeIcon, size = 26) => <I color={theme.text} size={size} strokeWidth={1.4} />;
  const trashCount = countTrash(snap);
  const syncLabel = !account
    ? t('notSignedIn')
    : status.state === 'offline'
      ? t('syncOffline')
      : status.state === 'expired'
        ? t('syncExpired')
        : t('syncingDevices');
  const go = (href: Parameters<typeof router.push>[0]) => {
    setMenu(false);
    router.push(href);
  };
  return (
    <View style={{ flex: 1 }}>
      <HomeHeader
        onMenu={(a) => {
          setMenuAnchor(a);
          setMenu(true);
        }}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + navInset }]}>
        <Text accessibilityRole="header" style={[styles.title, theme.kfont(compact ? 26 : 32, { color: theme.text, fontWeight: '800' })]}>
          {t('settings')}
        </Text>
        {/* 내 계정(로그인·동기화)은 서버에 닿을 때만(로그인해 둔 계정이 있으면 늘) */}
        {serverApi || account ? (
        <Pressable
          onPress={() => router.push('/settings/account')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.account, { backgroundColor: pressed ? theme.cardPressed : theme.card }]}
        >
          <PersonCircleIcon color={theme.circle} size={40} strokeWidth={1.12} />
          <View style={{ flex: 1, marginLeft: 13.5, transform: [{ translateY: -1.25 }] }}>
            <Text style={theme.kfont(16.5, { color: theme.text, fontWeight: '600' })}>{t('myAccount')}</Text>
            <Text style={theme.kfont(13, { color: theme.subtle, marginTop: 3 })} numberOfLines={1}>
              {syncLabel}
            </Text>
          </View>
          <View style={{ marginRight: -6.5 }}>
            <ChevronIcon color={theme.subtle} size={20} strokeWidth={1.7} />
          </View>
        </Pressable>
        ) : null}

        <Group title={t('screenAndWidgets')}>
          {/* 꾸미기: 오른쪽에 추천 테마색 4개를 바로 고를 수 있게(누르면 바로 적용). 글자·›를 누르면 전체 꾸미기 */}
          <Row icon={ic(SlidersIcon)} label={t('customize')} onPress={() => router.push('/settings/customize')} right={<QuickAccents />} last={Platform.OS === 'web'} />
          {Platform.OS !== 'web' ? <Row icon={ic(WidgetBoxIcon)} label={t('widgets')} onPress={() => router.push('/settings/widgets')} last /> : null}
        </Group>
        <Group title={t('todoSection')} style={{ marginBottom: 19 }} inset={[3.5, 3]}>
          <Row
            label={t('addAtBottom')}
            right={<Switch label={t('addAtBottom')} value={prefs.newTodoAt === 'bottom'} onChange={(v) => setPrefs({ newTodoAt: v ? 'bottom' : 'top' })} />}
          />
          <Row
            label={t('hideDone')}
            right={<Switch label={t('hideDone')} value={!prefs.showDone} onChange={(v) => setPrefs({ showDone: !v })} />}
            last
          />
        </Group>
        <Group inset={[4.5, 4.5]}>
          <Row
            icon={ic(GlobeIcon, 29)}
            label={t('language')}
            value={prefs.language === 'system' ? t('systemDefault') : LANG_NAMES[prefs.language]}
            onPress={() => router.push('/settings/language')}
          />
          {Platform.OS !== 'web' ? <Row icon={ic(MonitorIcon, 29)} label={t('pcUse')} onPress={() => router.push('/settings/pc')} /> : null}
          <Row icon={ic(HelpIcon, 29)} label={t('help')} onPress={() => router.push('/settings/guide')} last />
        </Group>
      </ScrollView>
      {navInset ? <BottomFade height={navInset + 28} /> : null}

      <Dropdown
        visible={menu}
        onClose={() => setMenu(false)}
        anchor={menuAnchor}
        items={[
          { icon: <TrashIcon color={theme.text} size={20} />, label: trashCount ? `${t('trash')} · ${trashCount}` : t('trash'), onPress: () => go('/settings/trash') },
          { icon: <BoxIcon color={theme.text} size={20} />, label: t('backup'), onPress: () => go('/settings/backup') },
          Platform.OS !== 'web' && { icon: <LockIcon color={theme.text} size={20} />, label: t('lockNotification'), onPress: () => go('/settings/lock') },
        ]}
      />
    </View>
  );
}

/**
 * 설정 첫 화면 꾸미기 줄의 추천 테마색 4개 + ›. 고른 색에만 얇은 테두리.
 * 맨 앞은 기본 하늘색, 나머지는 인기색(데이터가 모일 때까지는 정해 둔 추천색). 보는 동안 순서가 바뀌지 않게 화면을 열 때 한 번만 정하고,
 * 지금 쓰는 색이 추천에 없으면 마지막 자리에 보여 준다(선택 표시가 늘 보이게).
 */
function QuickAccents() {
  const { theme, prefs, setPrefs, t, repo, account } = useApp();
  // 인기 테마색은 이 줄이 보일 때만(하루 한 번 받아 둔 것, 앱을 켤 때·미니창에서는 받지 않는다). 받기 전엔 그리지 않아 순서가 바뀌어 보이지 않는다
  const [base, setBase] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadPopular(repo, account?.server ?? prefs.server, localDate(new Date())).then((p) => alive && setBase(recommendedAccents(p)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!base) return <View style={styles.quick} />;
  return (
    <View style={styles.quick}>
      {withCurrent(base, prefs.accent).map((c) => {
        const on = prefs.accent.toUpperCase() === c;
        return (
          <Pressable
            key={c}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${t('themeColor')} ${c}`}
            onPress={() => setPrefs({ accent: c })}
            hitSlop={5}
            style={[styles.quickRing, { borderColor: on ? theme.text : 'transparent' }]}
          >
            <View style={[styles.quickDot, { backgroundColor: c }, contrast(c, theme.card) < 1.3 && { borderWidth: 1, borderColor: theme.outline }]} />
          </Pressable>
        );
      })}
      <View style={{ marginLeft: 6, marginRight: -6.5 }}>
        <ChevronIcon color={theme.subtle} size={20} strokeWidth={1.7} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  quick: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quickRing: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  quickDot: { width: 19, height: 19, borderRadius: 9.5 },
  content: { paddingHorizontal: 18 },
  title: { paddingHorizontal: 7, paddingTop: 20, paddingBottom: 13.5 },
  account: { flexDirection: 'row', alignItems: 'center', borderRadius: 14.5, paddingLeft: 16, paddingRight: 18, minHeight: 73, marginBottom: 19 },
});
