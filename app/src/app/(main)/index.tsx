import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

import { toPlain } from '../../core/rich';
import { useApp } from '../../state/AppContext';
import { ItemSheets, type SheetState } from '../../ui/ItemSheets';
import { takeMenuPoint } from '../../ui/webLongPress';
import type { Editing } from '../../ui/home/Cards';
import { FolderBody } from '../../ui/home/FolderBody';
import { FolderTabs, HomeHeader, SearchBar } from '../../ui/home/Header';
import { useCollapsingHeader } from '../../ui/home/collapse';
import { countTrash, liveFolders } from '../../ui/home/model';
import { ScreenGradient } from '../../ui/glass';
import { useTop, useWide } from '../../ui/layout';
import { Dropdown } from '../../ui/Dropdown';

/**
 * 폴더 화면: 로고(modo) → 폴더 선택 → 그 폴더의 메모 하나 → 그 폴더의 할 일 → 입력창.
 * 폴더를 바꾸면 메모와 할 일이 함께 바뀐다. 처음엔 기본, 그 뒤엔 마지막으로 쓴 폴더. 몸통은 FolderBody(함께 탭과 같다).
 */
export default function Home() {
  const app = useApp();
  const { snap, filter, setFilter, prefs, setPrefs, t, serverApi, account } = app;
  const params = useLocalSearchParams<{ n?: string; folder?: string; edit?: string }>();
  const [editing, setEditing] = useState<Editing>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menu, setMenu] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<View | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const { compact } = useWide();
  // 가로로 눕힌 폰처럼 낮은 화면에서 키보드가 열리면 제목·탭을 숨겨 입력창이 보이게 한다.
  const [kb, setKb] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setKb(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setKb(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  const hideChrome = compact && kb;

  // 휴대폰: 머리를 목록 위에 띄우고 굴리면 접는다. 찾는 중에는 검색창이 늘 보이게 접지 않는다
  const floating = Platform.OS !== 'web';
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const top = useTop();
  // 재기 전 첫 화면: 로고 줄(약 38) + 폴더 줄(약 57)
  const [chromeH, setChromeH] = useState(top + 95);

  // 들어온 링크: 위젯 제목·'더 보기'(naegirok://?folder=…&n=<누른 시각>)와 iOS 위젯 글자(…&edit=할 일 id)는 그 폴더(와 그 할 일 편집)로.
  // n은 누를 때마다 다른 값이라(+native-intent.tsx) 같은 위젯을 다시 눌러도 다시 처리된다. 이펙트에서 처리한다
  // (예전엔 그리는 중에 다른 컴포넌트(AppProvider)의 상태를 바꾸고 DB에 썼다)
  const linkKey = `${params.n ?? ''}|${params.folder ?? ''}|${params.edit ?? ''}`;
  const snapRef = useRef(snap);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);
  useEffect(() => {
    if (!params.folder) return;
    setFilter(params.folder === 'base' ? null : params.folder);
    const todo = params.edit ? snapRef.current.todos.find((x) => x.id === params.edit) : undefined;
    if (todo) setEditing({ id: todo.id, caret: toPlain(todo.text).length });
    // 링크가 바뀔 때만(스냅샷이 바뀔 때마다 폴더를 다시 고르지 않게)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey]);

  // 홈에서 숨긴 공유 폴더(내 설정)는 폴더 줄에 두지 않는다. 공유는 그대로라 함께 탭에서 계속 보인다
  const hidden = useMemo(() => new Set(snap.shared.filter((s) => s.home === false).map((s) => s.folder_id)), [snap.shared]);
  const folders = useMemo(() => liveFolders(snap.folders).filter((f) => !hidden.has(f.id)), [snap.folders, hidden]);
  // 보고 있던 폴더를 숨겼으면 기본 폴더로
  useEffect(() => {
    if (filter && hidden.has(filter)) setFilter(null);
  }, [filter, hidden, setFilter]);
  const order = useMemo(() => ['base', ...folders.map((f) => f.id)], [folders]);
  const current = folders.find((f) => f.id === filter) ?? null;
  const sharedIds = useMemo(() => new Set(snap.shared.map((s) => s.folder_id)), [snap.shared]);
  const trashCount = useMemo(() => countTrash({ todos: snap.todos, paragraphs: snap.paragraphs }), [snap.todos, snap.paragraphs]);
  const collapse = useCollapsingHeader(Math.max(0, chromeH - insets.top), floating && search === null, filter ?? 'base');

  // 머리: 로고 줄 · (검색창) · 폴더 줄. 휴대폰은 목록 위에 겹쳐 띄우고 아래로 굴리면 접는다(collapse.ts), PC는 그대로 위에 고정
  const chrome = (
    <>
      {!hideChrome ? (
        // 글을 쓰다 머리(로고 줄)의 빈 곳을 눌러도 키보드를 닫고 쓰기를 끝낸다. 목록의 빈 곳은 목록이 이미 닫는다(사용자 요청 2026-10-19)
        <View onStartShouldSetResponder={() => Keyboard.isVisible()} onResponderRelease={() => Keyboard.dismiss()}>
        <HomeHeader
          onMenu={(a) => {
            setMenuAnchor(a);
            setMenu(true);
          }}
          onSearch={() => setSearch(search === null ? '' : null)}
          // 공유는 서버가 있어야 해서 서버에 닿을 때만
          onShare={serverApi ? () => (current ? router.push(`/share/${current.id}`) : setSheet({ type: 'base' })) : undefined}
        />
        </View>
      ) : null}
      {/* 검색: 폴더 줄 자리에 검색창이 뜨고 폴더 줄은 한 줄 아래로(지금 폴더 안에서 찾는다) */}
      {search !== null ? <SearchBar value={search} onChange={setSearch} onClose={() => setSearch(null)} /> : null}
      {hideChrome ? null : (
        <FolderTabs
          folders={folders}
          selected={filter}
          onSelect={(id) => {
            setEditing(null);
            setFilter(id);
          }}
          onLongPress={(f) => setSheet({ type: 'folder', id: f.id, at: takeMenuPoint() })}
          onLongPressBase={() => setSheet({ type: 'base', at: takeMenuPoint() })}
          onAdd={() => setSheet({ type: 'newFolder' })}
          sharedIds={sharedIds}
        />
      )}
    </>
  );
  const body = (
    <FolderBody
      filter={filter}
      order={order}
      search={search}
      editing={editing}
      setEditing={setEditing}
      setSheet={setSheet}
      // 키보드로 머리를 뺐을 때(낮은 화면)도 목록이 상태 표시줄 밑에서 시작하게
      topPad={floating ? Math.max(chromeH, insets.top) : undefined}
      onScroll={floating ? collapse.onScroll : undefined}
    />
  );

  return (
    <View style={{ flex: 1 }}>
      {floating ? (
        <>
          {body}
          <Animated.View onLayout={(e) => setChromeH(e.nativeEvent.layout.height)} style={[styles.chrome, collapse.style]}>
            {/* 머리 바탕 = 화면 바탕 그라데이션의 같은 자리(머리가 밀려도 바탕은 화면에 붙어 있다). 아래로 지나가는 목록을 가린다 */}
            <Animated.View pointerEvents="none" style={[styles.back, { height: frame.height }, collapse.backStyle]}>
              <ScreenGradient />
            </Animated.View>
            {chrome}
          </Animated.View>
          {/* 상태 표시줄 자리: 머리가 접혀도 목록이 시계·배터리 밑으로 지나가지 않게 */}
          <View pointerEvents="none" style={[styles.statusBar, { height: insets.top }]}>
            <View style={[styles.back, { height: frame.height }]}>
              <ScreenGradient />
            </View>
          </View>
        </>
      ) : (
        <>
          {chrome}
          {body}
        </>
      )}

      <Dropdown
        visible={menu}
        onClose={() => setMenu(false)}
        anchor={menuAnchor}
        title={current ? current.name : t('baseFolder')}
        items={[
          // 완료 숨기기·보기(설정의 '완료 항목 숨기기' 스위치와 같은 설정). 지우기는 완료 묶음 머리의 '완료 비우기'
          { label: prefs.showDone ? t('hideDone') : t('showDone'), onPress: () => setPrefs({ showDone: !prefs.showDone }) },
          { label: prefs.showRepeat ? t('hideRepeat') : t('showRepeat'), onPress: () => setPrefs({ showRepeat: !prefs.showRepeat }) },
          // 공유(사용자 요청 2026-10-26): 내 폴더는 친구 고르기, 공유받은 폴더는 공유 관리, 전체는 공유 메뉴(글 · 친구 · 모든 폴더)
          {
            label: t('share'),
            onPress: () =>
              !current
                ? setSheet({ type: 'base' })
                : sharedIds.has(current.id) || !account
                  ? router.push(`/share/${current.id}`)
                  : setSheet({ type: 'shareFriend', id: current.id }),
          },
          // 폴더 추가·삭제·공유는 폴더 관리 화면에서
          { label: t('manageFolders'), onPress: () => router.push('/folders') },
          // 옆으로 밀어 지운 할 일이 이 ⋯로 날아 들어오니, 여기서 바로 휴지통을 열 수 있게
          { label: trashCount ? `${t('trash')} · ${trashCount}` : t('trash'), onPress: () => router.push('/settings/trash') },
        ]}
      />
      <ItemSheets state={sheet} setState={setSheet} />
    </View>
  );
}

const styles = StyleSheet.create({
  chrome: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  back: { position: 'absolute', top: 0, left: 0, right: 0 },
  statusBar: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
});
