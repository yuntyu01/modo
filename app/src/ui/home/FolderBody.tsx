import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';
import { BlurTargetView } from 'expo-blur';

import { escapePlain } from '../../core/rich';
import type { FolderFilter, Paragraph } from '../../core/types';
import { useApp } from '../../state/AppContext';
import type { SheetState } from '../ItemSheets';
import { DoneHeader, MemoBlock, TodoCard, type Editing } from './Cards';
import { Composer } from './Composer';
import { HomeList } from './HomeList';
import { buildBlocks, isOrdered, neighborKeys, type Block, visibleParagraphs } from './model';
import { sweepStore } from './sweep';
import { BlurTargetContext, BottomFade } from '../glass';
import { useBottomInset, useWide } from '../layout';
import { coachComposerRef } from '../onboarding/coach';

/**
 * 한 폴더의 몸통: 메모 하나 → 할 일 → 완료 묶음 → 아래 입력창. 홈(목록)과 함께 탭이 같이 쓴다.
 * 머리(로고·폴더 줄·검색창)와 시트(ItemSheets)는 화면이 그린다: 폴더 줄의 길게 누르기·+도 같은 시트를 연다.
 */
export function FolderBody({
  filter,
  order,
  search,
  editing,
  setEditing,
  setSheet,
}: {
  /** 보여 줄 폴더(null = 기본) */
  filter: FolderFilter;
  /** 폴더 줄의 순서('base' = 기본): 폴더를 바꾼 방향으로 내용이 밀려 들어온다 */
  order: string[];
  /** 찾는 글(null = 찾기 닫힘) */
  search: string | null;
  editing: Editing;
  setEditing: Dispatch<SetStateAction<Editing>>;
  setSheet: (s: SheetState) => void;
}) {
  const { snap, prefs, repo, t, theme, canWrite, showToast } = useApp();
  const [todoMode, setTodoMode] = useState(true);
  const { compact } = useWide();
  // 입력창도 하단바 바로 위에 떠 있다. 목록은 바닥까지 그리고, 끝에 입력창 + 하단바 높이만큼 여백을 둔다.
  const navInset = useBottomInset();
  const [composerH, setComposerH] = useState(66);
  // 유리 입력창이 흐리게 비출 목록(입력창 자신은 대상 밖에 있어야 한다)
  const listRef = useRef<View>(null);

  // 폴더를 바꾼 방향(폴더 줄에서 오른쪽 폴더로 가면 1, 왼쪽이면 -1)
  const [seenFolder, setSeenFolder] = useState(filter);
  const [slideDir, setSlideDir] = useState(0);
  if (seenFolder !== filter) {
    setSeenFolder(filter);
    setSlideDir(Math.sign(order.indexOf(filter ?? 'base') - order.indexOf(seenFolder ?? 'base')));
  }
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

  // 완료 묶음의 '완료 비우기': 지울 카드들이 위에서부터 빠르게 하나씩 왼쪽으로 밀려 나간 뒤 지운다(sweep.ts, 휴대폰만)
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
  // 보기만 공유된 폴더에 메모가 없으면 빈 '메모' 자리를 두지 않는다(눌러도 쓸 수 없다)
  const showMemo = (!search || paragraphs.length > 0) && (writable || paragraphs.length > 0);
  // 메모 카드에 넘기는 것은 바뀔 때만 새로(memo): 할 일을 고쳐 저장할 때마다 문단 전부가 다시 그려졌다
  const onLongPressParagraph = useCallback((p: Paragraph) => setSheet({ type: 'paragraph', id: p.id }), [setSheet]);
  const onEmptyPress = useCallback(async () => {
    const [id] = await repo.appendParagraphs('', filter);
    if (id) setEditing({ id, caret: 0 });
  }, [repo, filter, setEditing]);
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
    <>
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
            bottomPad={(writable ? composerH : 0) + navInset + 16}
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
      {Platform.OS !== 'web' ? <BottomFade height={(writable ? composerH : 0) + navInset + 28} /> : null}
      {/* 보기만 공유된 폴더는 입력창을 두지 않는다(카드의 체크도 잠긴다. 서버도 쓰기를 거절한다) */}
      {writable ? (
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
                // 입력창 글은 꾸밈이 없다: 태그처럼 보이는 글자만 바꿔 적어 글자 그대로 남긴다(core/rich.ts)
                if (asTodo) await repo.addTodo(escapePlain(text), filter, prefs.newTodoAt);
                else await repo.appendParagraphs(escapePlain(text), filter);
                return true;
              }}
            />
          </View>
        </BlurTargetContext.Provider>
      </View>
      ) : null}
    </>
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
