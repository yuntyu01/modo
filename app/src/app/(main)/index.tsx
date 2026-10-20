import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';

import type { Paragraph } from '../../core/types';
import { useApp } from '../../state/AppContext';
import { ItemSheets, type SheetState } from '../../ui/ItemSheets';
import { DoneHeader, MemoBlock, TodoCard, type Editing } from '../../ui/home/Cards';
import { Composer } from '../../ui/home/Composer';
import { FolderTabs, HomeHeader, SearchBar } from '../../ui/home/Header';
import { HomeList } from '../../ui/home/HomeList';
import { buildBlocks, isOrdered, neighborKeys, type Block, countTrash, liveFolders, visibleParagraphs } from '../../ui/home/model';
import { sweepStore } from '../../ui/home/sweep';
import { BlurTargetView } from 'expo-blur';

import { BlurTargetContext, BottomFade } from '../../ui/glass';
import { useBottomInset, useWide } from '../../ui/layout';
import { Dropdown } from '../../ui/Dropdown';
import { coachComposerRef } from '../../ui/onboarding/coach';

/**
 * 폴더 화면: 로고(modo) → 폴더 선택 → 그 폴더의 메모 하나 → 그 폴더의 할 일 → 입력창.
 * 폴더를 바꾸면 메모와 할 일이 함께 바뀐다. 처음엔 기본, 그 뒤엔 마지막으로 쓴 폴더.
 */
export default function Home() {
  const app = useApp();
  const { snap, filter, setFilter, prefs, setPrefs, repo, t, theme, canWrite, showToast, serverApi } = app;
  const params = useLocalSearchParams<{ n?: string; folder?: string; edit?: string }>();
  const [editing, setEditing] = useState<Editing>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menu, setMenu] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<View | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [todoMode, setTodoMode] = useState(true);
  const { compact } = useWide();
  // 입력창도 하단바 바로 위에 떠 있다. 목록은 바닥까지 그리고, 끝에 입력창 + 하단바 높이만큼 여백을 둔다.
  const navInset = useBottomInset();
  const [composerH, setComposerH] = useState(66);
  // 유리 입력창이 흐리게 비출 목록(입력창 자신은 대상 밖에 있어야 한다)
  const listRef = useRef<View>(null);
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
    if (todo) setEditing({ id: todo.id, caret: todo.text.length });
    // 링크가 바뀔 때만(스냅샷이 바뀔 때마다 폴더를 다시 고르지 않게)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey]);

  const folders = useMemo(() => liveFolders(snap.folders), [snap.folders]);
  // 폴더를 바꾼 방향(폴더 줄에서 오른쪽 폴더로 가면 1, 왼쪽이면 -1)
  const [seenFolder, setSeenFolder] = useState(filter);
  const [slideDir, setSlideDir] = useState(0);
  if (seenFolder !== filter) {
    const order = ['base', ...folders.map((f) => f.id)];
    setSeenFolder(filter);
    setSlideDir(Math.sign(order.indexOf(filter ?? 'base') - order.indexOf(seenFolder ?? 'base')));
  }
  const current = folders.find((f) => f.id === filter) ?? null;
  const sharedIds = useMemo(() => new Set(snap.shared.map((s) => s.folder_id)), [snap.shared]);
  const trashCount = useMemo(() => countTrash({ todos: snap.todos, paragraphs: snap.paragraphs }), [snap.todos, snap.paragraphs]);
  const writable = canWrite(filter);

  // 입력 중인지(포커스 또는 초안 있음)는 입력창이 바뀔 때만 알려 준다. 초안 글자는 입력창·메모 커서만 읽는다(메모 모드에서 이어 쓸 자리 표시).
  const [composing, setComposing] = useState(false);

  const { blocks } = useMemo(
    () => buildBlocks({ snap, filter, showDone: prefs.showDone, query: search ?? '' }),
    [snap, filter, prefs.showDone, search],
  );
  const paragraphs = useMemo(
    () => visibleParagraphs({ paragraphs: snap.paragraphs, folders: snap.folders }, filter, search ?? ''),
    [snap.paragraphs, snap.folders, filter, search],
  );

  const onMove = (next: Block[], to: number) => {
    const moved = next[to];
    if (moved.kind === 'todo') repo.moveTo('todo', moved.todo.id, ...neighborKeys(next, to));
  };

  // 완료 묶음의 '전체 지우기': 지울 카드들이 위에서부터 빠르게 하나씩 왼쪽으로 밀려 나간 뒤 지운다(sweep.ts, 휴대폰만)
  const sweeping = useRef<string[] | null>(null);
  const clearDone = () => {
    if (sweeping.current) return;
    // 저장소의 clearDone과 같은 대상(완료한 보통 할 일. 반복은 다음 회차가 있어 남는다)
    const ids = blocks.flatMap((b) => (b.kind === 'todo' && b.todo.done && !b.todo.repeat_freq ? [b.key] : []));
    sweeping.current = ids;
    const wait = Platform.OS === 'web' ? 0 : sweepStore.start(ids);
    setTimeout(async () => {
      try {
        const removed = await repo.clearDone(filter);
        showToast({ message: t('deleted'), action: { label: t('undo'), run: () => repo.restore('todo', removed) } });
      } finally {
        // 보통은 목록에서 빠지면 바로 비운다(아래). 남아 있으면 잠시 뒤 비워 제자리로
        setTimeout(() => {
          if (sweeping.current !== ids) return;
          sweeping.current = null;
          sweepStore.clear();
        }, 1500);
      }
    }, wait);
  };
  // 쓸어 낸 카드가 목록에서 빠지면 쓸어 내기를 끝낸다(실행 취소로 돌아온 카드가 다시 쓸려 나가지 않게)
  useEffect(() => {
    const ids = sweeping.current;
    if (ids && !blocks.some((b) => ids.includes(b.key))) {
      sweeping.current = null;
      sweepStore.clear();
    }
  }, [blocks]);

  // 카드마다 길게 누르기 함수를 같은 것으로 유지한다(카드가 memo라 함수가 바뀌면 다시 그려진다).
  const longPressCache = useRef(new Map<string, { base: (info: () => void) => void; fn: () => void }>());
  const longPressFor = (id: string, base: (info: () => void) => void) => {
    const hit = longPressCache.current.get(id);
    if (hit && hit.base === base) return hit.fn;
    const fn = () => base(() => setSheet({ type: 'todo', id }));
    longPressCache.current.set(id, { base, fn });
    return fn;
  };

  // 보조 줄의 반복 아이콘·주기 → 반복 설정(카드마다 같은 함수라 memo된 카드가 다시 그려지지 않는다)
  const repeatCache = useRef(new Map<string, () => void>());
  const repeatPressFor = (id: string) => {
    let fn = repeatCache.current.get(id);
    if (!fn) repeatCache.current.set(id, (fn = () => setSheet({ type: 'repeat', id })));
    return fn;
  };

  // 오른쪽으로 밀기 → 정보 시트(카드마다 같은 함수)
  const infoCache = useRef(new Map<string, () => void>());
  const infoFor = (id: string) => {
    let fn = infoCache.current.get(id);
    if (!fn) infoCache.current.set(id, (fn = () => setSheet({ type: 'todo', id })));
    return fn;
  };

  // 없어진 할 일의 함수는 버린다(카드가 생길 때마다 하나씩 쌓였다). snap.todos는 바뀔 때만 새 배열
  useEffect(() => {
    const live = new Set(snap.todos.map((x) => x.id));
    for (const m of [longPressCache.current, repeatCache.current, infoCache.current]) for (const k of m.keys()) if (!live.has(k)) m.delete(k);
  }, [snap.todos]);

  const renderBlock = (b: Block, o: { onLongPress: (info: () => void) => void; active: boolean }) => {
    // 찾는 중에는 찾은 것만 보여서 지우기를 두지 않는다
    if (b.kind === 'done') return <DoneHeader count={b.count} onClear={b.clearable && writable && !search ? clearDone : undefined} />;
    return (
      <TodoCard
        todo={b.todo}
        editing={editing}
        setEditing={setEditing}
        readOnly={!canWrite(b.todo.folder_id)}
        onLongPress={longPressFor(b.todo.id, o.onLongPress)}
        onRepeatPress={repeatPressFor(b.todo.id)}
        onInfo={infoFor(b.todo.id)}
        active={o.active}
      />
    );
  };

  const showCaret = !todoMode && composing && !search;
  const showMemo = !search || paragraphs.length > 0;
  // 메모 카드에 넘기는 것은 바뀔 때만 새로(memo): 할 일을 고쳐 저장할 때마다 문단 전부가 다시 그려졌다
  const onLongPressParagraph = useCallback((p: Paragraph) => setSheet({ type: 'paragraph', id: p.id }), []);
  const onEmptyPress = useCallback(async () => {
    const [id] = await repo.appendParagraphs('', filter);
    if (id) setEditing({ id, caret: 0 });
  }, [repo, filter]);
  const memoEditing = editing && paragraphs.some((p) => p.id === editing.id) ? editing : null;
  const memo = showMemo ? (
    <MemoBlock
      paragraphs={paragraphs}
      editing={memoEditing}
      setEditing={setEditing}
      onLongPressParagraph={onLongPressParagraph}
      canWrite={canWrite}
      showCaret={showCaret}
      onEmptyPress={writable ? onEmptyPress : undefined}
    />
  ) : null;

  return (
    <View style={{ flex: 1 }}>
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
          onShare={serverApi ? () => (current ? router.push(`/share/${current.id}`) : showToast({ message: t('baseNotShareable') })) : undefined}
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
          onLongPress={(f) => setSheet({ type: 'folder', id: f.id })}
          onAdd={() => setSheet({ type: 'newFolder' })}
          sharedIds={sharedIds}
        />
      )}
      <BlurTargetView ref={listRef} style={{ flex: 1 }}>
        {/* 폴더를 바꾸면 그 방향(오른쪽 폴더면 오른쪽)에서 옆으로 밀려 들어온다(미니창과 같다) */}
        <Animated.View
          key={filter ?? 'base'}
          entering={Platform.OS !== 'web' && slideDir ? (slideDir > 0 ? FadeInRight : FadeInLeft).duration(220) : undefined}
          style={[{ flex: 1 }, Platform.OS === 'web' && slideDir ? (slideDir > 0 ? slideStyles.fromRight : slideStyles.fromLeft) : null]}
        >
        <HomeList
          blocks={blocks}
          dragEnabled={!search && !editing}
          isDraggable={(b) => isOrdered(b) && b.kind === 'todo' && canWrite(b.todo.folder_id)}
          renderBlock={renderBlock}
          onMove={onMove}
          bottomPad={composerH + navInset + 16}
          header={memo ?? undefined}
          footer={
            search && blocks.length === 0 && !paragraphs.length ? (
              <Text style={theme.font(15, { color: theme.muted, textAlign: 'center', marginTop: 48 })}>{t('noResults')}</Text>
            ) : undefined
          }
        />
        </Animated.View>
      </BlurTargetView>
      {/* 입력창·하단바 줄과 그 아래로 내려간 목록은 점점 희미하게 */}
      {Platform.OS !== 'web' ? <BottomFade height={composerH + navInset + 28} /> : null}
      <View
        pointerEvents="box-none"
        onLayout={(e) => setComposerH(e.nativeEvent.layout.height)}
        style={[
          { position: 'absolute', left: 0, right: 0, bottom: navInset, paddingHorizontal: Platform.OS === 'web' ? 17.5 : 18.4, paddingBottom: compact ? 6 : 12 },
          // PC 큰 창(시안): 할 일 블록과 같은 좌우 여백, 바탕색 띠 위에(목록은 띠 위에서 끝난다)
          theme.desk && { paddingHorizontal: 23.3, paddingTop: 5.3, paddingBottom: 4, backgroundColor: theme.bg },
        ]}
      >
        <BlurTargetContext.Provider value={listRef}>
          {/* 첫 실행 안내가 짚는 입력창 */}
          <View ref={coachComposerRef} collapsable={false} pointerEvents="box-none">
            <Composer
              todoMode={todoMode}
              setTodoMode={setTodoMode}
              draftFolder={filter}
              onComposingChange={setComposing}
              disabledReason={writable ? undefined : t('readOnly')}
              onFocusChange={(f) => {
                if (f) setEditing(null);
              }}
              onSubmit={async (asTodo, text) => {
                // 지금 보고 있는 폴더(초안이 묶인 폴더)에만 저장한다. 쓸 수 없는 폴더면 입력창이 잠겨 있다.
                if (!writable) return false;
                if (asTodo) await repo.addTodo(text, filter, prefs.newTodoAt);
                else await repo.appendParagraphs(text, filter);
                return true;
              }}
            />
          </View>
        </BlurTargetContext.Provider>
      </View>

      <Dropdown
        visible={menu}
        onClose={() => setMenu(false)}
        anchor={menuAnchor}
        title={current ? current.name : t('baseFolder')}
        items={[
          // 완료 숨기기·보기(설정의 '완료 항목 숨기기' 스위치와 같은 설정). 지우기는 완료 묶음 머리의 '전체 지우기'
          { label: prefs.showDone ? t('hideDone') : t('showDone'), onPress: () => setPrefs({ showDone: !prefs.showDone }) },
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

// PC(웹): 폴더를 바꿀 때 내용이 옆에서 밀려 들어오는 움직임(휴대폰은 Reanimated의 entering)
const slideStyles = StyleSheet.create({
  fromRight: {
    animationKeyframes: [{ '0%': { opacity: 0, transform: 'translateX(32px)' }, '100%': { opacity: 1, transform: 'translateX(0)' } }],
    animationDuration: '220ms',
    animationTimingFunction: 'ease-out',
  } as object,
  fromLeft: {
    animationKeyframes: [{ '0%': { opacity: 0, transform: 'translateX(-32px)' }, '100%': { opacity: 1, transform: 'translateX(0)' } }],
    animationDuration: '220ms',
    animationTimingFunction: 'ease-out',
  } as object,
});
