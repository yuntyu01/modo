import { useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Folder } from '../../core/types';
import { inputColors } from '../theme';
import { useApp } from '../../state/AppContext';
import { useTop, useWide } from '../layout';
import { CloseIcon, DotsIcon, PeopleIcon, PlusIcon, PopOutIcon, SearchIcon, ShareIcon } from '../Icons';
import { IconButton } from '../IconButton';
import { desktop } from '../../native/bridge';
import { Logo } from '../Logo';
import { TrashTargetIcon } from '../trashFlight';
import { useTabScroller } from './tabScroller';

/** 위쪽 기준선(useTop)에서 로고까지 */
const HEADER_GAP = -6;
/** PC 큰 창 오른쪽 위 아이콘: 크기·선 굵기를 하나로 */
const DESK_ICON = 22;
const DESK_STROKE = 1.8;

export function HomeHeader({
  onMenu,
  onSearch,
  onShare,
}: {
  /** ⋯를 눌렀을 때. 메뉴를 그 바로 아래에 펼치도록 버튼을 넘긴다 */
  onMenu: (anchor: View | null) => void;
  /** 검색 아이콘: 폴더 줄 자리에 검색창을 연다(폴더는 한 줄 아래로) */
  onSearch?: () => void;
  /** PC 큰 창: 공유 아이콘(시안). 서버에 연결돼 있을 때만 */
  onShare?: () => void;
}) {
  const { theme, t } = useApp();
  const top = useTop();
  const { compact } = useWide();
  const menuBtn = useRef<View>(null);
  // 옆으로 밀어 지운 할 일이 이 ⋯(휴지통이 든 메뉴)로 날아 들어온다
  const dots = (
    <TrashTargetIcon priority={2} size={(desktop ? 24 : 27) * theme.zoom}>
      <DotsIcon color={theme.circle} size={(desktop ? 24 : 27) * theme.zoom} />
    </TrashTargetIcon>
  );
  const menuButton = desktop ? (
    // PC: 창 오른쪽 끝이라 말풍선은 오른쪽 끝에 맞춘다(잘리지 않게)
    <IconButton buttonRef={menuBtn} label={t('menu')} onPress={() => onMenu(menuBtn.current)} tip="belowEnd" style={styles.deskIcon}>
      {dots}
    </IconButton>
  ) : (
    <Pressable ref={menuBtn} accessibilityLabel={t('menu')} onPress={() => onMenu(menuBtn.current)} hitSlop={14} style={{ marginLeft: 12, marginTop: 4 }}>
      {dots}
    </Pressable>
  );
  return (
    <View style={[styles.header, desktop && { paddingLeft: 23.5, paddingRight: 14, alignItems: 'flex-start' }, { paddingTop: desktop ? 16 : top + (compact ? 6 : HEADER_GAP) }]}>
      <View style={{ flex: 1, paddingVertical: compact ? 4 : 8 }}>
        {/* 앱 이름은 로고(심볼 + modo)로 */}
        <Logo height={(compact ? 17 : desktop ? 18.9 : 19.5) * theme.zoom} color={theme.text} markColor={theme.mark} markRatio={0.83} wordStretch={desktop ? 1 : 1.06} />
      </View>
      {desktop ? (
        // PC 큰 창(시안): 검색 · (공유) · 미니 메모 열기 · ⋯ 는 창 버튼(– □ ×) 바로 아래 줄에 겹쳐 둔다(머리 높이를 늘리지 않게).
        // 선 아이콘은 같은 크기(22)·같은 굵기(1.8)·같은 상자(28×28) 가운데에, 마우스를 올리면 이름 말풍선(접근성 이름과 같은 글)
        <View style={styles.deskIcons}>
          {onSearch ? (
            <IconButton label={t('search')} onPress={onSearch} style={styles.deskIcon}>
              <SearchIcon color={theme.circle} size={DESK_ICON} strokeWidth={DESK_STROKE} />
            </IconButton>
          ) : null}
          {onShare ? (
            <IconButton label={t('share')} onPress={onShare} style={styles.deskIcon}>
              <ShareIcon color={theme.circle} size={DESK_ICON} strokeWidth={DESK_STROKE} />
            </IconButton>
          ) : null}
          <IconButton label={t('openMini')} onPress={() => desktop?.toggleMini()} style={styles.deskIcon}>
            <PopOutIcon color={theme.circle} size={DESK_ICON} strokeWidth={DESK_STROKE} />
          </IconButton>
          {menuButton}
        </View>
      ) : null}
      {!desktop && onSearch ? (
        <Pressable accessibilityLabel={t('search')} onPress={onSearch} hitSlop={12} style={{ marginLeft: 12, marginTop: 4 }}>
          <SearchIcon color={theme.circle} size={25 * theme.zoom} />
        </Pressable>
      ) : null}
      {!desktop ? menuButton : null}
    </View>
  );
}

/** 검색창: 폴더 줄 자리에 뜨고 폴더 줄은 그 아래로 한 줄 내려간다(지금 폴더 안에서 찾고, 폴더를 바꾸면 그 폴더에서). Esc·×로 닫는다 */
export function SearchBar({ value, onChange, onClose }: { value: string; onChange: (s: string) => void; onClose: () => void }) {
  const { theme, t } = useApp();
  const { compact } = useWide();
  return (
    <View style={[styles.searchRow, desktop && styles.searchRowDesk, compact && { paddingTop: 4 }]}>
      <View style={[styles.search, { backgroundColor: theme.composer }, desktop && { height: 40, borderRadius: 20 }]}>
        <SearchIcon color={theme.subtle} size={(desktop ? 18 : 19) * theme.zoom} />
        <TextInput
          autoFocus
          value={value}
          {...inputColors(theme)}
          onChangeText={onChange}
          onKeyPress={(e) => Platform.OS === 'web' && e.nativeEvent.key === 'Escape' && onClose()}
          placeholder={t('searchPlaceholder')}
          placeholderTextColor={theme.subtle}
          style={[theme.font((desktop ? 15.5 : 16.5) * theme.zoom, { color: theme.text, flex: 1, marginLeft: 10 }), Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
          returnKeyType="search"
          accessibilityLabel={t('search')}
        />
        <Pressable accessibilityLabel={t('cancel')} onPress={onClose} hitSlop={10}>
          <CloseIcon color={theme.subtle} size={(desktop ? 18 : 19) * theme.zoom} />
        </Pressable>
      </View>
    </View>
  );
}

/** 로고만 있는 머리(캘린더처럼 폴더·⋯가 없는 화면). 홈 머리와 같은 자리·크기 */
export function LogoBar() {
  const { theme } = useApp();
  const top = useTop();
  const { compact } = useWide();
  return (
    <View style={[styles.header, desktop && { paddingLeft: 23.5, paddingRight: 14 }, { paddingTop: desktop ? 16 : top + (compact ? 6 : HEADER_GAP) }]}>
      <View style={{ flex: 1, paddingVertical: compact ? 4 : 8 }}>
        <Logo height={(compact ? 17 : desktop ? 18.9 : 19.5) * theme.zoom} color={theme.text} markColor={theme.mark} markRatio={0.83} wordStretch={desktop ? 1 : 1.06} />
      </View>
    </View>
  );
}

/**
 * 기본 / 폴더들 / +. 메모와 할 일을 함께 바꾸는 선택이라 메모 카드 바깥 위에 한 번만 둔다.
 * 밑줄·구분선·선택 배경 없이 글자 밝기와 굵기로만 선택을 구분한다. 실제 있는 폴더만 보인다.
 */
export function FolderTabs({
  folders,
  selected,
  onSelect,
  onLongPress,
  onAdd,
  sharedIds,
}: {
  folders: Folder[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onLongPress: (f: Folder) => void;
  onAdd: () => void;
  sharedIds: Set<string>;
}) {
  const { theme, t } = useApp();
  const { compact } = useWide();
  // 고른 폴더는 가운데로(휴대폰·PC). PC는 넘치면 휠·끌기로 옆으로도(미니창과 같다)
  const scrollRef = useRef<ScrollView>(null);
  const scroller = useTabScroller(scrollRef, selected ?? 'base', 0);
  const tab = (key: string, label: string, on: boolean, press: () => void, long?: () => void, shared?: boolean) => (
    <Pressable
      key={key}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      onPress={scroller.guard(press)}
      onLayout={scroller.tabLayout(key)}
      onLongPress={long}
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
      style={[styles.tab, desktop ? { marginRight: 33 } : { marginRight: 32 * theme.zoom }]}
    >
      {/* 폴더 이름: 예전(PC 18 · 휴대폰 20)보다 약 10% 작게, 고른 폴더 굵기는 그대로(사용자 요청 2026-10-18) */}
      <Text selectable={false} style={theme.kfont((desktop ? 16 : 18) * theme.zoom, { color: on ? theme.text : theme.tab, fontWeight: on ? '700' : '400', ...(desktop ? { lineHeight: 20 } : null) })}>{label}</Text>
      {shared ? (
        <View style={{ marginLeft: 4, opacity: 0.7 }}>
          <PeopleIcon color={on ? theme.text : theme.tab} size={15 * theme.zoom} />
        </View>
      ) : null}
    </Pressable>
  );
  return (
    <ScrollView
      ref={scrollRef}
      onLayout={scroller.onLayout}
      onScroll={scroller.onScroll}
      onContentSizeChange={scroller.onContentSizeChange}
      scrollEventThrottle={32}
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.tabs, desktop && { paddingLeft: 25.8, paddingTop: 15, paddingBottom: 18 }, compact && { paddingTop: 6, paddingBottom: 10 }]}
      // PC: 오른쪽 위 아이콘(공유·복사·⋯) 밑으로 폴더가 들어가 아이콘을 가리지 않게 그 자리를 비운다
      style={[{ flexGrow: 0 }, desktop && { marginRight: 128 }]}
    >
      {tab('base', t('baseFolder'), selected === null, () => onSelect(null))}
      {folders.map((f) => tab(f.id, f.name, selected === f.id, () => onSelect(f.id), () => onLongPress(f), sharedIds.has(f.id)))}
      <Pressable accessibilityLabel={t('addFolder')} onPress={onAdd} hitSlop={12} style={[styles.tab, { marginLeft: -4.5 }]}>
        {/* 폴더 글자 높이와 비슷하게 */}
        <PlusIcon color={theme.tab} size={desktop ? 16 : 17.5 * theme.zoom} strokeWidth={1.7} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 23.5, paddingRight: 22.5, minHeight: 44 },
  // PC: 창 버튼(– □ ×) 아래 줄(시안 y 48~65)
  // 아래 폴더 줄·검색창보다 위에 그려야 말풍선이 가려지지 않는다
  deskIcons: { position: 'absolute', right: 14, top: 44, flexDirection: 'row', alignItems: 'center', zIndex: 20 },
  deskIcon: { marginLeft: 14, width: 30, height: 30 },
  searchRow: { paddingHorizontal: 18.4, paddingTop: 14 },
  // PC: 할 일 블록과 같은 왼쪽 여백, 오른쪽 위 아이콘 자리는 비운다(폴더 줄과 같다)
  searchRowDesk: { paddingLeft: 23.3, paddingRight: 0, marginRight: 128, paddingTop: 12 },
  search: { flexDirection: 'row', alignItems: 'center', borderRadius: 23, paddingHorizontal: 16, height: 46 },
  tabs: { paddingLeft: 24.5, paddingRight: 24, paddingTop: 19.5, paddingBottom: 15, alignItems: 'center' },
  tab: { flexDirection: 'row', alignItems: 'center', marginRight: 32 },
});
