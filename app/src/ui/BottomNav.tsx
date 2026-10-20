import { router, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useUi } from '../state/AppContext';
import { useFriends } from '../state/friends';
import { CalendarIcon, DotsIcon, ListIcon, PeopleIcon } from './Icons';
import { mix } from './color';
import { GlassBackground } from './glass';
import { usePop, useSlidingPill } from './motion';
import { TrashTargetIcon } from './trashFlight';

const TABS = [
  { href: '/', Icon: ListIcon, label: 'list', text: 'todoSection' },
  { href: '/calendar', Icon: CalendarIcon, label: 'calendar', text: 'calendar' },
  // 함께: 친구와 함께 쓰는 폴더(시안). 받은 친구 요청이 있으면 아이콘 옆에 점
  { href: '/together', Icon: PeopleIcon, label: 'together', text: 'together' },
  { href: '/more', Icon: DotsIcon, label: 'more', text: 'more' },
] as const;

/** 휴대폰 하단바 높이(화이트 시안 49.4) */
export const NAV_HEIGHT = 49.4;

/**
 * 목록·캘린더·함께·더보기. 휴대폰(화이트 시안): 입력창과 같은 너비의 알약(높이 49.4), 그림자 없이 옅은 유리.
 * 고른 탭은 테마색 아이콘 + 옅은 테마색 알약(65×38), 나머지는 회색. 탭을 바꾸면 알약이 새 탭으로 흐르듯 미끄러지고(motion.ts) 새 아이콘이 살짝 튄다.
 * PC 큰 창: 창 아래에 붙은 줄에 같은 크기의 아이콘만(고른 것만 테마색, 나머지 회색, 밑줄·선택 상자 없이). 마우스를 올리면 이름 말풍선.
 */
export function BottomNav() {
  const { theme, t } = useUi();
  const path = usePathname();
  const incoming = useFriends().data.incoming.length;
  const web = Platform.OS === 'web';
  const idle = web ? theme.tab : theme.dark ? '#A3AAB8' : '#656A76';
  const { onItemLayout, pill } = useSlidingPill(web ? -1 : TABS.findIndex((x) => x.href === path));
  return (
    <View style={web ? styles.desktop : styles.bar}>
      {!web ? <GlassBackground color={theme.nav} /> : null}
      {!web && pill ? <Animated.View pointerEvents="none" style={[styles.pill, pill, { backgroundColor: mix(theme.nav, theme.accent, theme.dark ? 0.2 : 0.16) }]} /> : null}
      {TABS.map(({ href, Icon, label, text }, i) => {
        const active = path === href;
        return (
          <Pressable
            key={href}
            accessibilityRole="tab"
            accessibilityLabel={t(label)}
            accessibilityState={{ selected: active }}
            onPress={() => !active && router.replace(href)}
            onLayout={web ? undefined : onItemLayout(i)}
            hitSlop={6}
            style={web ? styles.deskTab : styles.tab}
          >
            {(state) => (
              <>
                {label === 'more' ? (
                  // 머리에 ⋯가 없는 화면(캘린더)에서는 지운 할 일이 이 ⋯ 탭(더보기 → 휴지통)으로 날아 들어온다
                  <TrashTargetIcon priority={1} size={web ? DESK_ICON : ICON.more}>
                    <Pop active={active}>
                      <Icon color={active ? theme.accent : idle} size={web ? DESK_ICON : ICON.more} />
                    </Pop>
                  </TrashTargetIcon>
                ) : (
                  <Pop active={active}>
                    <Icon color={active ? theme.accent : idle} size={web ? DESK_ICON : ICON[label]} />
                    {label === 'together' && incoming ? <View style={[styles.dot, { backgroundColor: theme.accent }]} /> : null}
                  </Pop>
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

/** 새로 고른 아이콘이 살짝 튀어 오른다 */
function Pop({ active, children }: { active: boolean; children: ReactNode }) {
  return <Animated.View style={usePop(active)}>{children}</Animated.View>;
}

/** 화이트 시안에서 잰 아이콘 그림 너비(목록·캘린더·더보기 모두 약 20.5dp)에 맞춘 크기 */
const ICON = { list: 28.5, calendar: 29, together: 28, more: 28 } as const;
/** PC 큰 창: 세 아이콘 같은 크기(그림 너비가 셋 다 약 17/24라 같은 값이면 같아 보인다) */
const DESK_ICON = 24;

const styles = StyleSheet.create({
  // 탭 네 개(목록·캘린더·함께·더보기)가 고르게: 탭 가운데가 양 끝에서 54.5(함께 시안)
  bar: { height: NAV_HEIGHT, borderRadius: NAV_HEIGHT / 2, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  // 고른 탭의 옅은 알약(65×38)
  tab: { width: 65, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  // 고른 탭 뒤를 따라 미끄러지는 알약(탭과 같은 크기, 하단바 가운데)
  pill: { top: (NAV_HEIGHT - 38) / 2, height: 38, borderRadius: 19 },
  // PC 큰 창: 창 아래에 붙은 평평한 줄, 탭마다 아이콘만
  desktop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', height: 50 },
  deskTab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  dot: { position: 'absolute', top: -1, right: -3, width: 7, height: 7, borderRadius: 3.5 },
  tip: { position: 'absolute', bottom: '100%', marginBottom: 2, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7 },
});
