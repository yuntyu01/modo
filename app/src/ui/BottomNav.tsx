import { router, usePathname } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '../state/AppContext';
import { CalendarIcon, DotsIcon, ListIcon } from './Icons';
import { mix } from './color';
import { GlassBackground } from './glass';
import { TrashTargetIcon } from './trashFlight';

const TABS = [
  { href: '/', Icon: ListIcon, label: 'list', text: 'navTodos' },
  { href: '/calendar', Icon: CalendarIcon, label: 'calendar', text: 'calendar' },
  { href: '/more', Icon: DotsIcon, label: 'more', text: 'more' },
] as const;

/** 휴대폰 하단바 높이(화이트 시안 49.4) */
export const NAV_HEIGHT = 49.4;

/**
 * 목록·캘린더·더보기. 휴대폰(화이트 시안): 입력창과 같은 너비의 알약(높이 49.4), 그림자 없이 옅은 유리.
 * 고른 탭은 테마색 아이콘 + 옅은 테마색 알약(65×38), 나머지는 회색.
 * PC 큰 창: 창 아래에 붙은 줄에 같은 크기의 아이콘만(고른 것만 테마색, 나머지 회색, 밑줄·선택 상자 없이). 마우스를 올리면 이름 말풍선.
 */
export function BottomNav() {
  const { theme, t } = useApp();
  const path = usePathname();
  const web = Platform.OS === 'web';
  const idle = web ? theme.tab : theme.dark ? '#A3AAB8' : '#656A76';
  return (
    <View style={web ? styles.desktop : styles.bar}>
      {!web ? <GlassBackground color={theme.nav} /> : null}
      {TABS.map(({ href, Icon, label, text }) => {
        const active = path === href;
        return (
          <Pressable
            key={href}
            accessibilityRole="tab"
            accessibilityLabel={t(label)}
            accessibilityState={{ selected: active }}
            onPress={() => !active && router.replace(href)}
            hitSlop={6}
            style={web ? styles.deskTab : [styles.tab, active && { backgroundColor: mix(theme.nav, theme.accent, theme.dark ? 0.2 : 0.16) }]}
          >
            {(state) => (
              <>
                {label === 'more' ? (
                  // 머리에 ⋯가 없는 화면(캘린더)에서는 지운 할 일이 이 ⋯ 탭(더보기 → 휴지통)으로 날아 들어온다
                  <TrashTargetIcon priority={1} size={web ? DESK_ICON : ICON.more}>
                    <Icon color={active ? theme.accent : idle} size={web ? DESK_ICON : ICON.more} />
                  </TrashTargetIcon>
                ) : (
                  <Icon color={active ? theme.accent : idle} size={web ? DESK_ICON : ICON[label]} />
                )}
                {/* PC: 마우스를 올리면 아이콘 위에 이름 말풍선 */}
                {web && (state as { hovered?: boolean }).hovered ? (
                  <View pointerEvents="none" style={[styles.tip, { backgroundColor: theme.dark ? '#3A3D44' : '#2B2E33' }]}>
                    <Text numberOfLines={1} style={theme.font(12, { color: '#FFFFFF' })}>
                      {t(text)}
                    </Text>
                  </View>
                ) : null}
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** 화이트 시안에서 잰 아이콘 그림 너비(목록·캘린더·더보기 모두 약 20.5dp)에 맞춘 크기 */
const ICON = { list: 28.5, calendar: 29, more: 28 } as const;
/** PC 큰 창: 세 아이콘 같은 크기(그림 너비가 셋 다 약 17/24라 같은 값이면 같아 보인다) */
const DESK_ICON = 24;

const styles = StyleSheet.create({
  // 탭 가운데가 양 끝에서 65(시안)
  bar: { height: NAV_HEIGHT, borderRadius: NAV_HEIGHT / 2, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 32.5 },
  // 고른 탭의 옅은 알약(65×38)
  tab: { width: 65, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  // PC 큰 창: 창 아래에 붙은 평평한 줄, 탭마다 아이콘만
  desktop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', height: 50 },
  deskTab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  tip: { position: 'absolute', bottom: '100%', marginBottom: 2, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7 },
});
