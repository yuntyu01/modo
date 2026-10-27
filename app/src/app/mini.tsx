import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { escapePlain, toPlain } from '../core/rich';
import type { FolderFilter, Paragraph } from '../core/types';
import { desktop } from '../native/bridge';
import { useApp, useDrafts, useSyncStatus, useUi } from '../state/AppContext';
import { withAlpha } from '../ui/color';
import { EditableText } from '../ui/EditableText';
import { MINI_CARD_GAP, MINI_RADIUS, TodoCard, type Editing } from '../ui/home/Cards';
import { Composer } from '../ui/home/Composer';
import { folderLabelOf, hiddenFolderIds, homeFolder, isRepeatDone, liveFolderIds, splitDone, todoInView, trimTrailingBlank, countTrash, liveFolders } from '../ui/home/model';
import { useWebReorder } from '../ui/home/webReorder';
import { useTabScroller } from '../ui/home/tabScroller';
import { CloseIcon, CollapseIcon, DotsIcon, ExpandIcon, PinIcon, PlusIcon } from '../ui/Icons';
import { IconButton } from '../ui/IconButton';
import { ItemSheets, isPointMenu, type SheetState } from '../ui/ItemSheets';
import { Logo, Mark } from '../ui/Logo';
import { takeMenuPoint, webContextMenu } from '../ui/webLongPress';

const drag = Platform.OS === 'web' ? ({ WebkitAppRegion: 'drag' } as object) : null;
const noDrag = Platform.OS === 'web' ? ({ WebkitAppRegion: 'no-drag' } as object) : null;

/**
 * Windows 미니창: 바탕화면이 비치는 반투명 바탕 하나에 로고 · 고정 · ⋯ · X / 폴더 탭(선택 밑줄) / 메모 / 할 일 / + 가 들어 있다.
 * 바탕은 살짝 비치게, 그 안의 메모·할 일 블록은 덜 투명하게(같은 재질). 테두리 없이, 창 = 바탕(둘레 투명 여백 없음).
 * +를 누르면 그 자리가 입력칸이 된다(비우고 나가면 다시 +). X는 창 숨기기(트레이에서 다시 연다).
 * ⋯: 완료한 할 일 보기/숨기기 · 휴지통(큰 창으로) · modo 열기 · 최소화.
 * 내용 높이를 메인 프로세스에 알려 창 높이를 맞추고, 최대 높이를 넘으면 할 일 영역만 스크롤한다.
 */
export default function Mini() {
  const { account } = useApp();
  const status = useSyncStatus();
  return !account || status.state === 'expired' ? <MiniLogin /> : <MiniWindow />;
}

/** 로그인하지 않았거나 만료됐으면 미니창은 안내만: 누르면 큰 창(로그인 화면)이 열린다 */
function MiniLogin() {
  const { theme, t } = useUi();
  useEffect(() => {
    if (Platform.OS === 'web') document.body.style.background = 'transparent';
    desktop?.setContentHeight(150);
  }, []);
  return (
    <View style={styles.root}>
      <View style={[styles.frame, styles.login, { backgroundColor: theme.bg }, drag]}>
        <Logo height={16} color={theme.text} markColor={theme.mark} />
        <Text style={theme.font(14, { color: theme.muted, marginTop: 14, textAlign: 'center' })}>{t('err_login_required')}</Text>
        <Pressable onPress={() => desktop?.openSettings()} accessibilityRole="button" hitSlop={8} style={[styles.loginBtn, noDrag]}>
          <Text style={theme.font(14, { color: theme.accent, fontWeight: '600' })}>{t('openMain')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MiniWindow() {
  const app = useApp();
  const { snap, repo, prefs, t, filter, setFilter, canWrite } = app;
  // 미니창 테마는 AppContext가 미니창 설정으로 만든다(안의 카드·입력창과 같은 테마)
  const theme = app.theme;
  const opacity = prefs.mini.opacity;
  const [editing, setEditing] = useState<Editing>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  // 시트(항목 정보·날짜·알림·반복·폴더)를 여는 동안 창이 짧으면 시트가 들어가게 잠깐 키운다(닫으면 원래 높이·자리로).
  // 오른쪽 클릭 메뉴는 누른 자리에 작게 떠서 창을 키우지 않는다
  const sheetOpen = sheet != null && !isPointMenu(sheet);
  const sheetWas = useRef(false);
  useEffect(() => {
    if (sheetOpen === sheetWas.current) return;
    sheetWas.current = sheetOpen;
    desktop?.setSheetHeight?.(sheetOpen ? SHEET_H : 0);
  }, [sheetOpen]);
  const [menu, setMenu] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [todoMode, setTodoMode] = useState(true);
  const [adding, setAdding] = useState(false);
  // 평소엔 위젯처럼 남은 할 일만, ⋯에서 켜면 완료한 것도 아래에(최근 완료 순)
  const [showDone, setShowDone] = useState(false);
  // 입력 중인지(+를 눌렀거나 초안이 있음). 초안 글자는 아래 MiniComposerSlot만 읽는다: 글자를 칠 때마다 미니창 전체(문단·카드)가 다시 그려졌다
  const [composing, setComposing] = useState(false);
  const topH = useRef(0);
  const listH = useRef(0);

  useEffect(() => {
    if (Platform.OS === 'web') document.body.style.background = 'transparent';
    desktop?.isPinned().then(setPinned);
  }, []);

  // 홈에서 숨긴 공유 폴더는 미니창 폴더 줄에도 두지 않는다(홈에 표시한 공유 폴더는 내 폴더처럼 고르고, 권한은 같게)
  const folders = liveFolders(snap.folders).filter((f) => snap.shared.find((s) => s.folder_id === f.id)?.home !== false);
  const hiddenFilter = !!filter && snap.shared.some((s) => s.folder_id === filter && s.home === false);
  useEffect(() => {
    if (hiddenFilter) setFilter(null);
  }, [hiddenFilter, setFilter]);
  // 선택한 폴더의 메모 하나와 그 폴더의 할 일. 전체(null)는 모든 폴더의 할 일 + 폴더 없는 메모·할 일(model.todoInView)
  const live = liveFolderIds(snap.folders);
  const hidden = hiddenFolderIds(snap.shared);
  const paragraphs: Paragraph[] = snap.paragraphs.filter((p) => !p.deleted_at && homeFolder(p.folder_id, live) === filter);
  // 앞날에 시작하는 반복도 보인다(아래 줄에 시작일). 이번 회차를 끝낸 반복은 다음 회차까지 체크된 채로 맨 아래에(완료 숨기기여도)
  const [openTodos, doneTodos] = splitDone(snap.todos.filter((x) => !x.deleted_at && todoInView(x.folder_id, filter, live, hidden)));
  const shownDone = showDone ? doneTodos : doneTodos.filter(isRepeatDone);
  // 꾹 눌러 끌어서 순서 바꾸기(놓으면 앞뒤 할 일 사이로 옮긴다). 그냥 꾹 누르기·오른쪽 클릭은 항목 정보
  const byId = new Map(openTodos.map((x) => [x.id, x]));
  const reorder = useWebReorder(
    openTodos.map((x) => x.id),
    (id, order) => {
      const i = order.indexOf(id);
      let prev = byId.get(order[i - 1])?.position ?? null;
      let next = byId.get(order[i + 1])?.position ?? null;
      // 이 폴더의 맨 앞·맨 끝이면 다른 폴더·완료한 할 일까지 통틀어 바로 옆 키 사이로(같은 키가 생기지 않게)
      const keys = snap.todos
        .filter((x) => x.id !== id)
        .map((x) => x.position)
        .sort();
      if (next == null && prev != null) next = keys.find((k) => k > prev!) ?? null;
      if (prev == null && next != null) prev = [...keys].reverse().find((k) => k < next!) ?? null;
      repo.moveTo('todo', id, prev, next);
    },
    (id) => setSheet({ type: 'todo', id, at: takeMenuPoint() }),
  );
  // 메모 칸 높이: 아래 가장자리를 끌어 늘리거나 줄인다(두 번 누르면 내용에 맞게). 이 PC에만 기억한다.
  const [memoH, setMemoH] = useState<number | null>(() => {
    try {
      window.localStorage.removeItem('modo.mini.memoHeight'); // 예전 키(위 MEMO_KEY 설명)
      const v = Number(window.localStorage.getItem(MEMO_KEY));
      return v > 0 ? v : null;
    } catch {
      return null;
    }
  });
  const memoBoxH = useRef(0);
  // 빈 메모를 누르면 아래 입력창(회색 초안)을 열지 않고 그 칸에서 바로 쓴다: 비어 있는 문단이 있으면 그 문단, 없으면 빈 문단을 하나 만들어서
  const startMemo = async () => {
    const blank = paragraphs.find((p) => canWrite(p.folder_id));
    if (blank) return setEditing({ id: blank.id, caret: 0 });
    const [id] = await repo.appendParagraphs('', filter);
    if (id) setEditing({ id, caret: 0 });
  };
  // 줄인 머리의 ⋯: 고정 · + · 펼치기를 옆으로 펼친다
  const [tools, setTools] = useState(false);
  // 펼치는 움직임(0.2초)이 끝나면 넘치는 부분을 보이게 해 '원래 크기로' 말풍선이 잘리지 않게
  const [toolsSettled, setToolsSettled] = useState(false);
  useEffect(() => {
    if (!tools) return;
    const timer = setTimeout(() => setToolsSettled(true), 220);
    return () => {
      clearTimeout(timer);
      setToolsSettled(false);
    };
  }, [tools]);
  const togglePin = async () => {
    await desktop?.setPinned(!pinned);
    setPinned(!pinned);
  };
  // 줄이기(⋯ → 최소화, 또는 고정 옆 버튼): 위쪽을 로고 · 폴더 · 펼치기 한 줄로 줄이고 아래엔 메모와 할 일만(+ 버튼들은 숨김). 이 PC에만 기억
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setCollapsed = (v: boolean) => {
    setCollapsedState(v);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
    } catch {}
  };
  // 바탕 아래 여백: 줄인 모양은 아래 + 없이 카드(아래 간격 6)로 끝나서, 그만큼 빼 옆 여백(6)과 같게
  const frameBottom = collapsed && !composing ? FRAME_BOTTOM - MINI_CARD_GAP : FRAME_BOTTOM;
  // 창 높이 = 위(머리·탭) + 목록 내용 + 바탕 아래 여백. 바탕 크기가 아니라 내용으로 재야 창이 늘어난다.
  const report = () => {
    desktop?.setContentHeight(topH.current + listH.current + frameBottom);
  };
  // 줄이고 펼 때 창 높이를 다시 맞춘다(부드럽게)
  useEffect(report, [collapsed]); // eslint-disable-line react-hooks/exhaustive-deps
  const [grip, setGrip] = useState(false);
  const startMemoResize = (startY: number) => {
    const startH = memoH ?? memoBoxH.current;
    let h = startH;
    document.body.style.userSelect = 'none';
    const move = (e: MouseEvent) => {
      h = Math.round(Math.min(900, Math.max(MEMO_MIN, startH + e.clientY - startY)));
      setMemoH(h);
    };
    const up = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      document.body.style.userSelect = '';
      try {
        window.localStorage.setItem(MEMO_KEY, String(h));
      } catch {}
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  };
  const resetMemoH = () => {
    setMemoH(null);
    try {
      window.localStorage.removeItem(MEMO_KEY);
    } catch {}
  };
  const trashCount = countTrash(snap);
  const writable = canWrite(filter);
  // 색은 휴대폰 앱과 같다(사용자 요청): 바탕은 위쪽 테마색 그라데이션에서 바탕색으로(뒤가 살짝 비친다), 블록(메모·할 일 같은 재질)은 카드색,
  // '+' 바와 입력칸은 입력창 색. 투명도 설정이 바탕과 블록을 함께 움직인다(위젯과 같은 0~100%: 100%면 바탕·블록 없이 글자만,
  // 0%면 전혀 비치지 않음). 기본(투명 20%)에서 바탕 80%·블록 90%로 예전과 같은 모습(사용자 요청 2026-10-21)
  const frameAlpha = opacity;
  const blockAlpha = Math.min(1, opacity * 1.125);
  // 블록(메모·할 일)은 앱 할 일 카드와 같은 색(다크는 테마색이 살짝 밴 카드색)에 미니창 투명도
  const block = withAlpha(theme.todoCardSolid, blockAlpha);
  const addPill = withAlpha(theme.composer, blockAlpha);
  const idleTab = theme.tab;
  const memoFont = theme.font(15, { color: theme.text, lineHeight: 21.5 });

  // 카드마다 같은 함수를 유지한다(카드는 memo라 함수가 바뀌면 다시 그려진다). 예전엔 그릴 때마다 새로 만들어
  // 입력칸에 글자를 칠 때마다(초안이 바뀌어 미니창이 다시 그려질 때마다) 모든 카드가 다시 그려졌다
  const startDrag = reorder.start;
  const [handlers] = useState(() => new Map<string, { long: () => void; repeat: () => void }>());
  useEffect(() => {
    const live = new Set(snap.todos.map((x) => x.id));
    for (const k of handlers.keys()) if (!live.has(k)) handlers.delete(k);
  }, [snap.todos, handlers]);
  const handlersFor = (id: string) => {
    let h = handlers.get(id);
    if (!h) {
      h = { long: () => startDrag(id), repeat: () => setSheet({ type: 'repeat', id }) };
      handlers.set(id, h);
    }
    return h;
  };
  const card = (todo: (typeof openTodos)[number]) => (
    <TodoCard
      key={todo.id}
      todo={todo}
      editing={editing}
      setEditing={setEditing}
      readOnly={!canWrite(todo.folder_id)}
      onLongPress={handlersFor(todo.id).long}
      onRepeatPress={handlersFor(todo.id).repeat}
      surface={block}
      folderLabel={filter === null ? folderLabelOf(todo.folder_id, snap.folders) : undefined}
    />
  );
  const iconBtn = (label: string, onPress: () => void, child: React.ReactNode) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={[styles.icon, noDrag]}>
      {child}
    </Pressable>
  );
  // 폴더를 바꾼 방향(폴더 줄에서 오른쪽 폴더로 가면 1, 왼쪽이면 -1): 내용이 그쪽에서 밀려 들어온다
  const order = ['base', ...folders.map((f) => f.id)];
  const [seenFolder, setSeenFolder] = useState(filter);
  const [slideDir, setSlideDir] = useState(0);
  // 메모 문단·할 일은 처음엔 한 화면 넘게(PAGE개)만 그리고 끝에 가까워지면 더 그린다: 문단·할 일이 수백 개인 폴더로 바꿀 때
  // 전부 그려 130ms쯤 멈췄다(2026-10-18 측정). 창은 화면 높이까지라 그 밖은 스크롤해야 보인다
  const [memoCount, setMemoCount] = useState(PAGE);
  const [todoCount, setTodoCount] = useState(PAGE);
  if (seenFolder !== filter) {
    setSeenFolder(filter);
    setSlideDir(Math.sign(order.indexOf(filter ?? 'base') - order.indexOf(seenFolder ?? 'base')));
    setMemoCount(PAGE);
    setTodoCount(PAGE);
  }
  const nearEnd = (e: { nativeEvent: { contentOffset: { y: number }; layoutMeasurement: { height: number }; contentSize: { height: number } } }) =>
    e.nativeEvent.contentOffset.y + e.nativeEvent.layoutMeasurement.height > e.nativeEvent.contentSize.height - 300;
  // 폴더 줄: 넘치면 휠·끌기로 옆으로, 고른 폴더는 가운데로
  const tabsRef = useRef<ScrollView>(null);
  const tabsScroll = useTabScroller(tabsRef, filter ?? 'base', collapsed);
  // 폴더 이름은 오른쪽 클릭하면 그 자리에 폴더 메뉴(전체는 없다)
  const folderMenu = (id: string) => () => setSheet({ type: 'folder', id, at: takeMenuPoint() });
  const tab = (key: string, label: string, on: boolean, press: () => void, long?: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      onPress={tabsScroll.guard(press)}
      onLayout={tabsScroll.tabLayout(key)}
      hitSlop={8}
      style={[styles.tab, noDrag]}
      {...webContextMenu(long)}
    >
      {/* 고른 폴더는 진한 색 + 굵게, 나머지는 연한 회색(밑줄·배경 없이). 끌어서 넘길 때 글자가 선택돼 남지 않게 선택 막기 */}
      <Text
        selectable={false}
        style={theme.font(14.5, {
          color: on ? theme.text : idleTab,
          fontWeight: on ? '700' : '400',
          lineHeight: 19,
        })}
      >
        {label}
      </Text>
    </Pressable>
  );
  const menuItem = (label: string, run: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="menuitem"
      onPress={() => {
        setMenu(false);
        run();
      }}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
        styles.menuItem,
        noDrag,
        (hovered || pressed) && {
          backgroundColor: withAlpha(theme.text, 0.07),
        },
      ]}
    >
      <Text style={theme.font(15, { color: theme.text })}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.frame, { paddingBottom: frameBottom }]}>
        {/* 바탕: 휴대폰 홈처럼 위쪽 테마색 그라데이션에서 바탕색으로(뒤가 살짝 비친다) */}
        <LinearGradient
          pointerEvents="none"
          colors={[withAlpha(theme.gradientTop, frameAlpha), withAlpha(theme.gradientMid, frameAlpha), withAlpha(theme.bg, frameAlpha)]}
          locations={theme.gradientStops}
          style={[StyleSheet.absoluteFill, { borderRadius: FRAME_RADIUS }]}
        />
        {/* 머리(로고·폴더·버튼)는 아래 메모·할 일보다 위에 그린다: 버튼 말풍선이 그 밑으로 가려지지 않게 */}
        <View
          style={styles.top}
          onLayout={(e) => {
            topH.current = e.nativeEvent.layout.height;
            report();
          }}
        >
          {collapsed ? (
            // 줄인 머리: 로고 그림 · 폴더 · (고정해 두었으면 고정 표시) · ⋯. ⋯를 누르면 고정 · +(입력칸) · 펼치기가 옆으로 펼쳐진다
            <View style={[styles.head, styles.collapsedHead, drag]}>
              <Pressable onPress={() => desktop?.openSettings()} accessibilityRole="button" accessibilityLabel="modo" style={noDrag}>
                <Mark height={13} color={theme.mark} />
              </Pressable>
              <ScrollView
                ref={tabsRef}
                onLayout={tabsScroll.onLayout}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.collapsedTabs}
                style={styles.collapsedTabsBox}
              >
                {/* 도구를 펼친 동안엔 고른 폴더 이름만(다른 폴더가 반쯤 잘려 보이지 않게) */}
                {!tools || filter === null ? tab('base', t('baseFolder'), filter === null, () => setFilter(null)) : null}
                {folders.filter((f) => !tools || filter === f.id).map((f) => tab(f.id, f.name, filter === f.id, () => setFilter(f.id), folderMenu(f.id)))}
              </ScrollView>
              <View
                style={[styles.tools, { maxWidth: tools ? 112 : 0, opacity: tools ? 1 : 0 }, toolsSettled && { overflow: 'visible' }, toolsMotion]}
                pointerEvents={tools ? 'auto' : 'none'}
              >
                {iconBtn(
                  pinned ? t('unpin') : t('pin'),
                  () => togglePin().then(() => setTools(false)),
                  <PinIcon color={pinned ? theme.accent : idleTab} size={16} filled={pinned} />,
                )}
                {writable
                  ? iconBtn(
                      t('add'),
                      () => {
                        setAdding(true);
                        setTools(false);
                      },
                      <PlusIcon color={idleTab} size={18} strokeWidth={1.7} />,
                    )
                  : null}
                {/* 크기 전환(작업표시줄로 내리는 최소화가 아니다): 줄인 상태에서는 바깥으로 벌어지는 화살표 '원래 크기로' */}
                <IconButton
                  label={t('miniRestore')}
                  onPress={() => {
                    setTools(false);
                    setCollapsed(false);
                  }}
                  hitSlop={6}
                  style={[styles.icon, noDrag]}
                >
                  <ExpandIcon color={idleTab} size={16} />
                </IconButton>
              </View>
              {pinned && !tools ? iconBtn(t('unpin'), togglePin, <PinIcon color={theme.accent} size={15} filled />) : null}
              {iconBtn(t('menu'), () => setTools(!tools), <DotsIcon color={tools ? theme.accent : idleTab} size={20} />)}
            </View>
          ) : (
            <>
              <View style={[styles.head, drag]}>
                <Pressable onPress={() => desktop?.openSettings()} accessibilityRole="button" accessibilityLabel="modo" style={noDrag}>
                  <Logo height={16} color={theme.text} markColor={theme.mark} />
                </Pressable>
                <View style={{ flex: 1 }} />
                {/* 크기 전환: 원래 크기에서는 안으로 모이는 화살표 '작게 보기'(창 위쪽을 한 줄로 줄이고 메모·할 일은 그대로) */}
                <IconButton label={t('miniCompact')} onPress={() => setCollapsed(true)} hitSlop={6} style={[styles.icon, noDrag]}>
                  <CollapseIcon color={idleTab} size={16} />
                </IconButton>
                {iconBtn(pinned ? t('unpin') : t('pin'), togglePin, <PinIcon color={pinned ? theme.accent : idleTab} size={17} filled={pinned} />)}
                {iconBtn(t('menu'), () => setMenu(true), <DotsIcon color={idleTab} size={20} />)}
                {iconBtn(t('hideWindow'), () => desktop?.hide(), <CloseIcon color={idleTab} size={14} />)}
              </View>
              <ScrollView
                ref={tabsRef}
                onLayout={tabsScroll.onLayout}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabs}
                style={{ flexGrow: 0 }}
              >
                {tab('base', t('baseFolder'), filter === null, () => setFilter(null))}
                {folders.map((f) => tab(f.id, f.name, filter === f.id, () => setFilter(f.id), folderMenu(f.id)))}
                <Pressable accessibilityLabel={t('addFolder')} onPress={() => setSheet({ type: 'newFolder' })} hitSlop={8} style={[styles.tab, noDrag]}>
                  <PlusIcon color={idleTab} size={16} strokeWidth={1.7} />
                </Pressable>
              </ScrollView>
            </>
          )}
        </View>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listBody}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={100}
          onScroll={(e) => nearEnd(e) && todoCount < reorder.ordered.length + shownDone.length && setTodoCount((n) => n + PAGE)}
          onContentSizeChange={(_w, h) => {
            listH.current = h;
            report();
          }}
        >
          {/* 폴더를 바꾸면 내용이 그 방향(오른쪽 폴더면 오른쪽)에서 옆으로 밀려 들어온다 */}
          <View key={filter ?? 'base'} style={slideDir > 0 ? styles.slideFromRight : slideDir < 0 ? styles.slideFromLeft : null}>
          {/* 메모 블록: 내용만큼(화면 높이의 40%까지) 늘어나고, 아래 가장자리를 끌어 높이를 정할 수 있다 */}
          <View style={[styles.memo, { backgroundColor: block }]}>
            <ScrollView
              style={[styles.memoScroll, { minHeight: MEMO_MIN }, memoH != null ? { height: Math.max(MEMO_MIN, memoH) } : { maxHeight: MEMO_MAX }]}
              contentContainerStyle={styles.memoScrollBody}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={100}
              onScroll={(e) => nearEnd(e) && memoCount < paragraphs.length && setMemoCount((n) => n + PAGE)}
              onLayout={(e) => (memoBoxH.current = e.nativeEvent.layout.height)}
            >
              {paragraphs.some((p) => p.text) || (editing && paragraphs.some((p) => p.id === editing.id)) ? (
                // 편집 중인 문단은 늘 그린다(뒤쪽 문단을 고치다 폴더를 다시 그려도 사라지지 않게)
                // 끝에 이어진 빈 줄은 그리지 않는다(model.ts trimTrailingBlank)
                trimTrailingBlank(paragraphs, editing?.id)
                  .slice(0, Math.max(memoCount, paragraphs.findIndex((p) => p.id === editing?.id) + 1))
                  .map((p, i) => {
                  // 앞에서부터 자른 목록이라 i가 paragraphs의 자리와 같다
                  const prev = paragraphs[i - 1];
                  return (
                  <EditableText
                    key={p.id}
                    id={p.id}
                    text={p.text}
                    editing={editing?.id === p.id ? { caret: editing.caret } : null}
                    readOnly={!canWrite(p.folder_id)}
                    style={memoFont}
                    onStartEdit={(caret) => setEditing({ id: p.id, caret })}
                    onEndEdit={() => setEditing(null)}
                    onSave={(text) => repo.setParagraphText(p.id, text)}
                    onLongPress={() => setSheet({ type: 'paragraph', id: p.id, at: takeMenuPoint() })}
                    onSplit={async (before, after, caret) => {
                      const ids = await repo.splitParagraph(p.id, before, after);
                      if (ids.length) setEditing({ id: ids[ids.length - 1], caret });
                    }}
                    onMergeBack={
                      prev && canWrite(prev.folder_id)
                        ? async (text) => {
                            const caret = toPlain(prev.text).length;
                            await repo.setParagraphText(p.id, text);
                            await repo.mergeParagraphInto(prev.id, p.id);
                            setEditing({ id: prev.id, caret });
                          }
                        : undefined
                    }
                  />
                  );
                })
              ) : (
                <Pressable onPress={startMemo} disabled={!writable} style={{ cursor: 'text' } as object}>
                  <Text
                    style={theme.font(15, {
                      color: theme.subtle,
                      lineHeight: 21.5,
                    })}
                  >
                    {t('memoEmpty')}
                  </Text>
                </Pressable>
              )}
            </ScrollView>
            {/* 아래 가장자리 손잡이(끌어서 높이 조절, 두 번 눌러 내용에 맞게). 평소엔 보이지 않고 올리면 가는 막대만 */}
            {writable || paragraphs.length ? (
              <View
                accessibilityLabel={t('memoResize')}
                style={[styles.memoHandle, noDrag, { cursor: 'ns-resize' } as object]}
                {...({
                  onMouseDown: (e: { button: number; clientY: number; preventDefault: () => void }) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    startMemoResize(e.clientY);
                  },
                  onDoubleClick: resetMemoH,
                  onMouseEnter: () => setGrip(true),
                  onMouseLeave: () => setGrip(false),
                } as object)}
              >
                {grip ? <View style={[styles.memoGrip, { backgroundColor: withAlpha(theme.text, 0.14) }]} /> : null}
              </View>
            ) : null}
          </View>

          {reorder.ordered.slice(0, todoCount).map((id) => {
            const todo = byId.get(id);
            return todo ? (
              <View key={id} onLayout={reorder.onRowLayout(id)} style={reorder.rowStyle(id)}>
                {card(todo)}
              </View>
            ) : null;
          })}
          {shownDone.slice(0, Math.max(0, todoCount - reorder.ordered.length)).map(card)}

          {/* +를 누르면 그 자리가 입력칸(쓰던 글이 있으면 계속 입력칸). 줄인 모양에선 아래 + 없이(머리의 +로 입력칸을 연다) */}
          <MiniComposerSlot
            adding={adding}
            setAdding={setAdding}
            filter={filter}
            todoMode={todoMode}
            setTodoMode={setTodoMode}
            writable={writable}
            collapsed={collapsed}
            addPill={addPill}
            idleTab={idleTab}
            onComposing={setComposing}
          />
          </View>
        </ScrollView>
      </View>

      {/* ⋯ 메뉴: 작은 창이라 아래 시트 대신 ⋯ 바로 아래 작게 펼친다. 바깥을 누르면 닫힌다. */}
      {menu ? (
        <>
          <Pressable accessibilityLabel={t('cancel')} onPress={() => setMenu(false)} style={[StyleSheet.absoluteFill, noDrag]} />
          {/* 메뉴는 뒤가 비치면 글자가 겹쳐 읽기 어려워 불투명하게 */}
          <View
            accessibilityRole="menu"
            style={[
              styles.menu,
              {
                backgroundColor: theme.dark ? '#2A2D33' : '#FFFFFF',
                shadowOpacity: theme.dark ? 0.5 : 0.18,
              },
            ]}
          >
            {menuItem(showDone ? t('hideDone') : t('showDone'), () => setShowDone(!showDone))}
            {menuItem(trashCount ? `${t('trash')} · ${trashCount}` : t('trash'), () => desktop?.openSettings('/settings/trash'))}
            {menuItem(t('openMain'), () => desktop?.openSettings())}
            {menuItem(t('miniCompact'), () => setCollapsed(true))}
          </View>
        </>
      ) : null}
      <ItemSheets state={sheet} setState={setSheet} />
    </View>
  );
}

const FRAME_BOTTOM = 6;
/** 시트를 여는 동안 미니창 최소 높이: 가장 큰 시트(반복 설정·날짜 달력)가 스크롤 없이 들어가는 높이 */
const SHEET_H = 600;
// v2: 예전에 끌어 둔 높이(메모보다 훨씬 길게 남아 있던 것)는 한 번 비워 내용에 맞게(최소 2줄) 다시 시작한다(사용자 요청 2026-10-18)
const MEMO_KEY = 'modo.mini.memoHeight.v2';
/** 한 번에 더 그리는 메모 문단·할 일 수(미니창 한 화면보다 넉넉히) */
const PAGE = 40;
/** 메모 칸 최소 높이: 2줄(글자 줄 높이 21.5) */
const MEMO_MIN = 2 * 21.5;
const COLLAPSED_KEY = 'modo.mini.collapsed';
/** 줄인 머리의 도구가 옆으로 나오는 움직임(웹: CSS 전환) */
const toolsMotion = Platform.OS === 'web' ? ({ transitionProperty: 'max-width, opacity', transitionDuration: '200ms', transitionTimingFunction: 'ease-out' } as object) : null;
// 메모 칸 최대 높이: 지금 창 높이가 아니라 화면 높이로 정한다(창은 내용에 맞춰 늘어나므로, 창 높이로 정하면 메모가 4줄쯤에서 막혀
// 메모를 더 써도 창이 늘지 않고 칸 안에서만 스크롤됐다). 화면의 40%까지는 창이 늘어나고, 그보다 길면 메모 칸 안에서 스크롤.
const MEMO_MAX = Math.min(420, Math.max(160, (typeof window !== 'undefined' ? window.screen.availHeight : 800) * 0.4));
const FRAME_RADIUS = 18;

// 수치는 시안(150% 화면)에서 잰 px ÷ 1.5
/** 아래 입력칸 또는 +. 초안(글자마다 바뀐다)은 여기만 읽어서 글자를 칠 때 미니창 전체가 다시 그려지지 않는다 */
function MiniComposerSlot({
  adding,
  setAdding,
  filter,
  todoMode,
  setTodoMode,
  writable,
  collapsed,
  addPill,
  idleTab,
  onComposing,
}: {
  adding: boolean;
  setAdding: (v: boolean) => void;
  filter: FolderFilter;
  todoMode: boolean;
  setTodoMode: Dispatch<SetStateAction<boolean>>;
  writable: boolean;
  collapsed: boolean;
  addPill: string;
  idleTab: string;
  onComposing: (v: boolean) => void;
}) {
  const { repo, prefs, t } = useUi();
  const draft = useDrafts().draftOf(filter, todoMode);
  const composing = adding || !!draft;
  useEffect(() => onComposing(composing), [composing, onComposing]);
  // 입력칸에서 나가면 잠깐 기다렸다 +로 접는다(그 사이 토글을 누르거나 다시 들어오면 그대로)
  const collapse = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (collapse.current) clearTimeout(collapse.current);
    },
    [],
  );
  if (composing) {
    return (
      <Composer
        variant="card"
        surface={addPill}
        autoFocus
        todoMode={todoMode}
        setTodoMode={setTodoMode}
        draftFolder={filter}
        disabledReason={writable ? undefined : t('readOnly')}
        onFocusChange={(f) => {
          if (collapse.current) clearTimeout(collapse.current);
          collapse.current = f ? null : setTimeout(() => setAdding(false), 1200);
        }}
        onSubmit={async (asTodo, text) => {
          if (!writable) return false;
          if (asTodo) await repo.addTodo(escapePlain(text), filter, prefs.newTodoAt);
          else await repo.appendParagraphs(escapePlain(text), filter);
          return true;
        }}
      />
    );
  }
  if (writable && !collapsed) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={t('add')} onPress={() => setAdding(true)} style={[styles.add, noDrag, { backgroundColor: addPill }]}>
        <PlusIcon color={idleTab} size={19} strokeWidth={1.6} />
      </Pressable>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  login: { alignItems: 'center', justifyContent: 'center', paddingTop: 12 },
  loginBtn: { marginTop: 10, paddingVertical: 6, paddingHorizontal: 12 },
  // 창 = 바탕(둘레 투명 여백 없음): 창 가장자리, 곧 크기 조절 손잡이가 보이는 바탕 끝에 있다. 바깥 모서리 18(부드럽게), 안쪽 좌우 6·아래 6
  // (12에서 절반으로, 사용자 요청 2026-10-27)
  frame: {
    flex: 1,
    borderRadius: FRAME_RADIUS,
    paddingHorizontal: 6,
    paddingBottom: FRAME_BOTTOM,
  },
  // 작은 창이라 머리(로고·버튼)와 폴더 줄을 낮게. 로고 위아래가 넓어 보여 50 → 45(사용자 요청 2026-10-23),
  // 바탕 여백을 절반으로 줄이면서 로고 위아래도 14.5 → 7.5로 45 → 31(2026-10-27)
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    // 바로 아래 폴더 줄보다 위에(버튼 말풍선이 폴더 이름에 가려지지 않게)
    zIndex: 2,
    height: 31,
    paddingLeft: 3,
    paddingRight: 0,
  },
  icon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    marginLeft: 4,
  },
  tabs: {
    paddingLeft: 4,
    paddingRight: 8,
    // 폴더 줄 아래(메모 칸까지)도 바탕 여백과 같이 절반으로 9 → 5
    paddingBottom: 5,
    alignItems: 'center',
  },
  tab: { marginRight: 18, alignItems: 'center' },
  // 접은 모양: 한 줄(높이 31, 펼친 머리와 같게: 폴더 글자 줄 위아래 6), 로고 옆에 폴더
  top: { zIndex: 5 },
  collapsedHead: { height: 31 },
  collapsedTabsBox: { flex: 1, flexGrow: 1, marginLeft: 16 },
  collapsedTabs: { alignItems: 'center', paddingRight: 8 },
  tools: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  // 폴더를 바꿀 때 내용이 옆에서 밀려 들어오는 움직임(0.22초)
  slideFromRight: {
    animationKeyframes: [{ '0%': { opacity: 0, transform: 'translateX(32px)' }, '100%': { opacity: 1, transform: 'translateX(0)' } }],
    animationDuration: '220ms',
    animationTimingFunction: 'ease-out',
  } as object,
  slideFromLeft: {
    animationKeyframes: [{ '0%': { opacity: 0, transform: 'translateX(-32px)' }, '100%': { opacity: 1, transform: 'translateX(0)' } }],
    animationDuration: '220ms',
    animationTimingFunction: 'ease-out',
  } as object,
  // 스크롤 막대가 카드 위에 겹치지 않게 목록을 바탕 안쪽 여백(6)까지 넓히고, 카드는 그만큼 안쪽에서 시작
  list: { flexShrink: 1, marginHorizontal: -6 },
  listBody: { paddingTop: 0, paddingHorizontal: 6 },
  // 메모 칸 안 스크롤 막대도 글자 위가 아니라 메모 칸 오른쪽 여백에
  memoScroll: { marginRight: -10 },
  memoScrollBody: { paddingRight: 10 },
  // 메모 칸 아래 여백(11) 위에 겹치는 손잡이 자리
  memoHandle: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memoGrip: { width: 24, height: 2, borderRadius: 1 },
  // 안쪽 블록은 바깥 창보다 덜 둥글게(MINI_RADIUS)
  memo: {
    borderRadius: MINI_RADIUS,
    paddingLeft: 13,
    paddingRight: 13,
    paddingTop: 11,
    paddingBottom: 11,
    marginBottom: 8,
  },
  // '+' 바: 가로로 긴 모양은 그대로, 높이 28
  add: {
    height: 28,
    borderRadius: MINI_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    position: 'absolute',
    zIndex: 10,
    // 펼친 머리(31) 바로 아래, ⋯ 단추(아래 끝 29.5) 밑. 오른쪽 끝은 X 단추 오른쪽 끝 가까이
    top: 34,
    right: 4,
    minWidth: 190,
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 12,
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 6,
    borderRadius: 9,
  },
});
