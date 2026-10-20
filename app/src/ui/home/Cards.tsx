import { memo, useEffect, useState } from 'react';
import { Animated, PixelRatio, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ruleOf } from '../../core/repeat';
import type { Paragraph, Todo } from '../../core/types';
import { useApp, useDrafts, useUi } from '../../state/AppContext';
import { EditableText } from '../EditableText';
import { cardLate, cardWhen, formatDue, parseLocalDate, repeatShort } from '../format';
import { CheckIcon, RepeatGlyphIcon, RepeatRingIcon, RingIcon } from '../Icons';
import { coachTodoRef, useCoach } from '../onboarding/coach';
import { useWebLongPress } from '../webLongPress';
import { trimTrailingBlank } from './model';
import { SwipeToDelete } from './SwipeToDelete';

export type Editing = { id: string; caret: number } | null;

/** 줄 간격도 앱 글자 크기 × 시스템 글자 크기를 따라가야 큰 글자에서 줄이 겹치거나 잘리지 않는다. */
export function useCardStyles() {
  const { theme, prefs } = useUi();
  const fs = PixelRatio.getFontScale();
  const z = theme.zoom;
  const kind = theme.desk ? 'desk' : theme.mini ? 'mini' : 'phone';
  // 제목 약 16(미니창 15.5·중간 굵기), 보조 줄 12~12.5(사용자 요청 2026-10-18). 줄 높이도 앱 글자 크기 × 시스템 글자 크기를 따른다
  const textBase = theme.mini ? 20 : theme.desk ? 20 : 22;
  const metaBase = theme.mini ? 16 : 17;
  const textLine = Math.round(textBase * z * theme.scale * fs);
  const metaSize = (theme.mini ? 12 : 12.5) * z;
  const metaLine = Math.round(metaBase * z * theme.scale * fs);
  // 카드 최소 높이(미니 52 · PC 60 · 휴대폰 64, 사용자 요청 2026-10-18 — 미니는 56이 커 보여 52로). 앱 글자 크기 설정만 따르고 화면 배율(zoom)은 곱하지 않는다(요청한 숫자 그대로)
  const minH = Math.round(CARD_MIN_H[kind] * theme.scale);
  // 위아래 여백: 시스템 글자 크기가 기본일 때 '제목 1줄 + 4 + 보조 줄'(정보 있는 카드)과 '제목 2줄'(정보 없는 카드, 넘치면 …)이
  // 둘 다 최소 높이 안에 들어가게. 그보다 짧은 카드는 같은 최소 높이에 글 묶음이 가운데.
  // 글자를 키우면(시스템 글자 확대·편집으로 펼침) 여백은 그대로 두고 카드가 늘어난다
  const title1 = Math.round(textBase * z * theme.scale);
  const withMeta = title1 + META_GAP + Math.round(metaBase * z * theme.scale);
  const padY = Math.max(MIN_PAD_Y, Math.min(minH - withMeta, minH - title1 * TITLE_LINES.plain) / 2);
  const right = prefs.checkSide === 'right';
  return {
    text: theme.mini
      ? theme.kfont(15.5 * z, { color: theme.text, fontWeight: '500', lineHeight: textLine })
      : theme.kfont(16 * z, { color: theme.text, lineHeight: textLine }),
    // 보조 줄(반복 주기·날짜·시간): 읽을 수 있는 회색 하나로
    meta: theme.kfont(metaSize, { color: theme.muted, lineHeight: metaLine }),
    metaGap: META_GAP,
    /** 할 일 카드 최소 높이(정보가 있든 없든 같다. 내용이 길면 늘어난다) */
    minH,
    padY,
    /** 카드 사이 간격(미니 6 · PC 8 · 휴대폰 8) */
    gap: CARD_GAP[kind],
    /**
     * 동그라미 지름: 휴대폰 25.5, PC 큰 창 21.5, 미니창 20.4. 반복 동그라미도 바깥 크기가 같다.
     * 2026-10-18에 약 20% 줄였다가(휴대폰 22.5 · PC 19 · 미니 18) 2026-10-19에 셋 다 같은 비율(×24/22.5)로, 2026-10-20에 한 번 더
     * 같은 비율(×1.0625)로 키웠다(사용자 요청). 안의 체크도 같은 비율, 반복 표시는 지름의 0.6
     */
    circle: (theme.desk ? 21.5 : theme.mini ? 20.4 : CIRCLE) * z * theme.scale,
    /** 동그라미와 제목 사이 */
    circleGap: right ? 20 * z : theme.desk ? 20 : theme.mini ? 14 : 20 * z,
    /** 카드 좌우 안쪽 여백(모든 카드 같게: 제목 시작 자리·오른쪽 끝이 카드마다 같다) */
    padL: (right ? 22 : theme.desk ? 16 : theme.mini ? 13 : 17.5) * z,
    padR: (right ? 17.5 : theme.desk ? 15 : theme.mini ? 13 : 22) * z,
    /** 입력창·달력 '할 일 추가' 칸 높이: 카드 높이를 통일할 때 입력창은 그대로 두라고 해서 예전 한 줄 카드 높이를 쓴다 */
    inputH: Math.round(INPUT_PAD_Y[kind] * 2 * z + textLine),
    memo: theme.kfont((theme.desk ? 17 : 17) * z, { color: theme.text, lineHeight: (theme.desk ? 26 : 28.5) * z * theme.scale * fs }),
    memoLine: (theme.desk ? 26 : 28.5) * z * theme.scale * fs,
  };
}

/** 할 일 카드 최소 높이(px·dp) */
const CARD_MIN_H = { phone: 64, desk: 60, mini: 52 } as const;
/** 카드 사이 간격(px·dp) */
const CARD_GAP = { phone: 8, desk: 8, mini: 6 } as const;
/** 미니창 카드 사이(창 아래 여백 계산용) */
export const MINI_CARD_GAP = CARD_GAP.mini;
/**
 * 제목과 보조 줄 사이(줄 상자끼리). 줄 높이 안에 글자 위아래 여백이 3~4씩 들어 있어 0이어도 글자 사이는 6~8로 보인다
 * (4일 때 10~12로 벌어져 보여 줄였다, 사용자 요청 2026-10-18)
 */
const META_GAP = 0;
/**
 * 읽을 때 제목 최대 줄 수(넘치면 …): 날짜·반복 줄이 있으면 1줄, 없으면 2줄 — 그래야 카드 높이가 같다(사용자 요청 2026-10-18).
 * PC는 잘린 제목에 마우스를 올리면 전체 제목 말풍선, 누르면 펼쳐진다(편집, 보기 전용은 펼치기/접기)
 */
const TITLE_LINES = { meta: 1, plain: 2 } as const;
/** 글자가 커져도 남기는 위아래 여백 */
const MIN_PAD_Y = 6;
/** 입력창 높이를 정하던 예전 카드 위아래 여백(입력창은 그대로) */
const INPUT_PAD_Y = { phone: 15, desk: 14, mini: 14 } as const;

type TodoProps = {
  todo: Todo;
  editing: Editing;
  setEditing: (e: Editing) => void;
  onLongPress: () => void;
  readOnly: boolean;
  active?: boolean;
  /** 전체 보기·캘린더에서 원래 폴더 이름(작은 보조 글자) */
  folderLabel?: string;
  /** 캘린더처럼 날짜가 이미 정해진 화면: 날짜를 빼고 폴더 이름을 강조색으로 */
  hideDue?: boolean;
  /** 카드 오른쪽 끝에 붙는 작은 버튼(캘린더의 '날짜 지정') */
  /** 캘린더의 날짜 없는 할 일: '날짜 지정' 버튼(카드가 그려서 memo가 깨지지 않는다) */
  onSetDate?: () => void;
  /** 시안마다 다른 카드 높이(캘린더의 날짜 없는 할 일은 57) */
  minHeight?: number;
  /** 카드 바탕(미니창은 메모 패널과 같은 재질로 맞춘다). 없으면 앱 테마의 할 일 카드색 */
  surface?: string;
  /** 보조 줄의 반복 아이콘·주기를 눌렀을 때(반복 설정 열기). 없으면 눌리지 않는다 */
  onRepeatPress?: () => void;
  /** 휴대폰: 카드를 오른쪽으로 밀었을 때(정보 시트). 왼쪽은 지우기 */
  onInfo?: () => void;
};

export const TodoCard = memo(function TodoCard({
  todo,
  editing,
  setEditing,
  onLongPress,
  readOnly,
  active,
  folderLabel,
  hideDue,
  onSetDate,
  minHeight,
  surface,
  onRepeatPress,
  onInfo,
}: TodoProps) {
  const { theme, prefs, repo, t, showToast, lang, today } = useUi();
  const st = useCardStyles();
  const right = prefs.checkSide === 'right';
  const isEditing = editing?.id === todo.id;
  // 체크하면 잠깐 채워진 동그라미를 보여 준 뒤 완료 묶음으로 내려 보낸다.
  const [checking, setChecking] = useState(false);
  const [seenDoneAt, setSeenDoneAt] = useState(todo.done_at);
  if (seenDoneAt !== todo.done_at) {
    setSeenDoneAt(todo.done_at);
    setChecking(false);
  }
  const done = todo.done || checking;
  const overdue = !!todo.due_date && !done && todo.due_date < today;
  const rule = ruleOf(todo);
  const toggle = () => {
    // 완료해 둔 반복 할 일의 체크를 풀면 오늘 할 일로 되돌린다
    if (todo.done) return rule ? repo.reopenRepeat(todo.id) : repo.setDone(todo.id, false);
    if (checking) return;
    setChecking(true);
    setTimeout(async () => {
      if (!rule) return repo.setDone(todo.id, true);
      // 반복: 완료로 남기지 않고 다음 예정일로 넘긴다(그날 다시 나타난다). 실행 취소로 되돌릴 수 있다.
      const r = await repo.complete(todo.id);
      setChecking(false);
      if (r) {
        showToast({
          message: t('repeatNext', { date: formatDue(r.next, lang) }),
          action: { label: t('undo'), run: () => repo.undoComplete(todo.id, r.prev) },
        });
      }
    }, CHECK_DELAY);
  };
  // 옆으로 밀어 지우기와 화면 읽기 프로그램의 '삭제' 동작: 휴지통으로(바로 실행 취소, 휴지통에서 복원)
  const remove = () => {
    repo.trash('todo', [todo.id]);
    showToast({ message: t('deleted'), action: { label: t('undo'), run: () => repo.restore('todo', [todo.id]) } });
  };
  // 보조 줄: 주기 · 날짜·시간 · (기한이 지났으면) N일 지남 · (캘린더) 폴더 · 충돌 사본. 반복 여부는 동그라미가 보여 준다.
  // 없는 것은 빼서 빈 구분점·빈 줄이 남지 않는다(format.ts cardWhen)
  const now = parseLocalDate(today);
  const when = cardWhen(todo, lang, { hideDate: hideDue, now });
  const late = overdue && !hideDue ? cardLate(todo.due_date!, lang, now) : null;
  const rest = [when, late, folderLabel, todo.conflict_of ? t('conflictCopy') : null].filter(Boolean);
  const hasMeta = !!rule || rest.length > 0;

  // PC: 카드 어디를 꾹 누르거나 오른쪽 클릭해도(제목·보조 줄·빈 곳) 길게 누르기(정보·끌어서 순서 바꾸기).
  // 제목 글자에서만 되던 것을 카드 전체로. 동그라미·버튼(반복 주기·날짜 지정)·편집 중 입력칸은 제 동작 그대로
  // 첫 실행 안내가 짚을 카드(방금 적은 첫 할 일)
  const coach = useCoach();
  const webLong = useWebLongPress(isEditing ? undefined : onLongPress, {
    skip: (el) => !!el.closest('[role="checkbox"], [role="button"], textarea, input'),
  });

  // PC는 테두리 대신 그린 동그라미(브라우저가 1.7 같은 테두리를 1px로 깎아 가늘고 울퉁불퉁해 보였다)
  const circle = st.circle;
  // 반복 할 일은 같은 크기·굵기의 동그라미를 두 곡선 화살표로. 완료하면 테마색으로 채우고 체크 대신 흰 반복 표시
  // (완료 묶음에서 다음 회차가 오는 반복인지 바로 보이게, 사용자 시안 2026-10-19). 동그라미 크기는 다른 완료와 같게
  // (시안처럼 1.3배로 키웠더니 완료 묶음에서 동그라미 크기가 들쭉날쭉해 보였다)
  const repeatDone = done && !!rule;
  const repeatRing = !!rule && !done;
  const ring = (theme.desk || theme.mini) && !done && !repeatRing;
  // 테두리도 크기에 맞춰 얇게(PC 1.35 · 휴대폰 1.6), 미니창은 예전 그대로 1.5
  const stroke = theme.desk ? 1.35 : theme.mini ? 1.5 : styles.circle.borderWidth;
  const check = (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done, disabled: readOnly }}
      accessibilityLabel={rule ? `${todo.text}, ${t('repeat')}` : todo.text}
      disabled={readOnly}
      hitSlop={12}
      onPress={toggle}
      accessibilityActions={readOnly ? undefined : [{ name: 'delete', label: t('delete') }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'delete' && remove()}
      style={[
        styles.circle,
        { borderColor: theme.circle, width: circle, height: circle, borderRadius: circle / 2 },
        right ? { marginLeft: st.circleGap } : { marginRight: st.circleGap },
        (ring || repeatRing) && { borderWidth: 0 },
        done && { backgroundColor: theme.accent, borderColor: theme.accent },
      ]}
    >
      {ring ? <RingIcon color={theme.circle} size={circle} strokeWidth={stroke} /> : null}
      {repeatRing ? <RepeatRingIcon color={theme.circle} size={circle} strokeWidth={stroke} /> : null}
      {repeatDone ? <RepeatGlyphIcon color={theme.onAccent} size={circle * 0.6} strokeWidth={2.5} /> : null}
      {done && !rule ? <CheckIcon color={theme.onAccent} size={(theme.desk ? 13.25 : theme.mini ? 16 : 12.75) * theme.zoom * theme.scale} /> : null}
    </Pressable>
  );

  return (
    <SwipeToDelete
      enabled={!readOnly && !isEditing && !active}
      onDelete={remove}
      onInfo={onInfo}
      label={todo.text}
      sweepKey={todo.id}
      radius={theme.mini ? MINI_RADIUS : theme.desk ? DESK_RADIUS : styles.card.borderRadius}
      // 카드 사이(미니 6 · PC 8 · 휴대폰 8). 카드 위·목록 쪽에는 따로 여백을 두지 않아 겹쳐 커지지 않는다
      style={{ marginBottom: st.gap }}
    >
      <View
        {...(webLong as object)}
        ref={coach?.todoId === todo.id ? coachTodoRef : undefined}
        collapsable={false}
        style={[
          styles.card,
          // 높이: 최소 높이(고정 아님)에 동그라미와 글 묶음(제목, 또는 제목 + 보조 줄)을 세로 가운데로. 내용이 길면 늘어난다
          { backgroundColor: active ? theme.cardPressed : (surface ?? theme.todoCard), minHeight: Math.max(st.minH, minHeight ?? 0) },
          (theme.mini || theme.desk) && { borderRadius: theme.desk ? DESK_RADIUS : MINI_RADIUS },
          { paddingLeft: st.padL, paddingRight: st.padR },
        ]}
      >
        {!right && check}
        <View style={{ flex: 1, paddingVertical: st.padY }}>
          <EditableText
            id={todo.id}
            text={todo.text}
            editing={isEditing ? { caret: editing!.caret } : null}
            readOnly={readOnly}
            style={{ ...st.text, ...(done ? { color: theme.muted, textDecorationLine: 'line-through' } : null) }}
            onStartEdit={(caret) => setEditing({ id: todo.id, caret })}
            onEndEdit={() => setEditing(null)}
            onSave={(text) => (text.trim() ? repo.setTodoText(todo.id, text) : Promise.resolve())}
            onLongPress={Platform.OS === 'web' ? undefined : onLongPress}
            lines={hasMeta ? TITLE_LINES.meta : TITLE_LINES.plain}
          />
          {hasMeta ? (
            <View style={[styles.metaRow, { marginTop: st.metaGap }]}>
              {rule ? (
                // 주기: 누르면 반복 설정(작아도 위아래로 넉넉히 눌리게, 완료·제목 편집으로 넘어가지 않는다)
                <Pressable
                  onPress={onRepeatPress}
                  disabled={!onRepeatPress || readOnly}
                  hitSlop={{ top: 12, bottom: 12, left: 8, right: 6 }}
                  accessibilityRole={onRepeatPress && !readOnly ? 'button' : undefined}
                  accessibilityLabel={`${t('repeat')} ${repeatShort(rule, lang, todo.due_date)}`}
                  style={styles.repeat}
                >
                  <Text style={[st.meta, styles.metaText]}>{repeatShort(rule, lang, todo.due_date)}</Text>
                </Pressable>
              ) : null}
              {rest.length ? (
                <Text style={[st.meta, styles.metaText]}>
                  {rest.map((x, i) => {
                    // 밀린 날짜와 'N일 지남'만 빨간색, 나머지 보조 정보는 같은 회색. 폴더 이름(캘린더)은 테마색(사용자 요청 2026-10-17)
                    const color = (x === when || x === late) && overdue && !hideDue ? theme.danger : x === folderLabel ? theme.accent : undefined;
                    return (
                      <Text key={i} style={color ? { color } : null}>
                        {i || rule ? '  ·  ' : ''}
                        {x}
                      </Text>
                    );
                  })}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        {onSetDate ? (
          <Pressable onPress={onSetDate} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${todo.text} ${t('setDate')}`} style={{ marginLeft: 10 }}>
            <Text style={theme.kfont(13.5 * theme.zoom, { color: theme.subtle })}>{t('setDate')}</Text>
          </Pressable>
        ) : null}
        {right && check}
      </View>
    </SwipeToDelete>
  );
}, sameTodoCard);

/** 편집 중인 카드가 바뀌어도 그 카드와 직전 카드만 다시 그리게 비교한다(입력·편집 중 목록 전체를 다시 그리지 않게). */
function sameTodoCard(a: TodoProps, b: TodoProps) {
  const editA = a.editing?.id === a.todo.id ? a.editing : null;
  const editB = b.editing?.id === b.todo.id ? b.editing : null;
  return (
    a.todo === b.todo &&
    editA === editB &&
    a.readOnly === b.readOnly &&
    a.active === b.active &&
    a.folderLabel === b.folderLabel &&
    a.hideDue === b.hideDue &&
    a.onSetDate === b.onSetDate &&
    a.minHeight === b.minHeight &&
    a.surface === b.surface &&
    a.onRepeatPress === b.onRepeatPress &&
    a.onInfo === b.onInfo &&
    a.setEditing === b.setEditing &&
    a.onLongPress === b.onLongPress
  );
}

const CHECK_DELAY = 350;
/** PC 미니창 블록 모서리(시안) */
// 미니창 안쪽 카드·메모·+ 바: 바깥 창(18)보다 덜 둥글게
export const MINI_RADIUS = 8;
/** PC 큰 창 블록 모서리(시안) */
const DESK_RADIUS = 12;
/** 완료 동그라미 지름(dp). 22.5에서 아주 조금 키웠다(사용자 요청 2026-10-19) */
const CIRCLE = 25.5;

/**
 * 완료 묶음 머리: 왼쪽 '완료 N', 오른쪽 '전체 지우기'(보이는 완료한 보통 할 일을 휴지통으로, 실행 취소 가능).
 * '완료 N'은 작은 옅은 회색 글씨(보조 글자보다 옅게, 조금 굵게)로 카드 왼쪽 끝 가까이(사용자 시안 2026-10-19의 #898E97 근처.
 * 한때 'To do 3'처럼 크고 검게 했다가 되돌림).
 * 숨기기·보기는 머리의 펼침 표시 대신 ⋯ 메뉴에서, 지우기는 ⋯ 메뉴의 '완료한 할 일 정리' 대신 여기서 한다(사용자 요청 2026-10-19).
 */
export function DoneHeader({ count, onClear }: { count: number; onClear?: () => void }) {
  const { theme, t } = useUi();
  return (
    <View style={styles.doneHeader}>
      <Text accessibilityRole="header" style={theme.font(15 * theme.zoom, { color: theme.dark ? '#8C8E94' : '#898E97', fontWeight: '600', flex: 1 })}>
        {t('doneSection')} {count}
      </Text>
      {onClear ? (
        <Pressable accessibilityRole="button" onPress={onClear} hitSlop={10}>
          {({ pressed }) => (
            <Text style={theme.font(15 * theme.zoom, { color: theme.accent, fontWeight: '600', opacity: pressed ? 0.6 : 1 })}>{t('clearAllDone')}</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

type MemoProps = {
  paragraphs: Paragraph[];
  editing: Editing;
  setEditing: (e: Editing) => void;
  onLongPressParagraph: (p: Paragraph) => void;
  /** 이 폴더에 쓸 수 있는지(AppContext.canWrite 그대로: 늘 같은 함수) */
  canWrite: (folderId: string | null) => boolean;
  /** 메모 모드로 입력 중이면 끝에 입력 위치(초안)를 보여 준다 */
  showCaret?: boolean;
  /** 빈 메모를 누르면(그 칸에서 바로 쓰게 빈 문단을 만든다) */
  onEmptyPress?: () => void;
};

/**
 * 지금 폴더의 메모 문서 하나. 문단들을 이어서 한 장으로 보여 주고 문단 옆에 아이콘을 붙이지 않는다.
 * 짧으면 내용만큼만, 길면 접어 두고 '더 보기'로 펼친다(할 일이 끝없이 밀려 내려가지 않게).
 * 접힌 상태에서 이어 쓰는 중이면 끝부분(입력 위치)이 보이게 아래쪽을 보여 준다.
 */
export const MemoBlock = memo(function MemoBlock({ paragraphs: all, editing, setEditing, onLongPressParagraph, canWrite, showCaret = false, onEmptyPress }: MemoProps) {
  const { theme, repo, t } = useUi();
  // 끝에 이어진 빈 줄은 그리지 않는다(model.ts trimTrailingBlank). 빈 메모 판단·빈 문단에서 쓰기는 전체로
  const paragraphs = trimTrailingBlank(all, editing?.id);
  const st = useCardStyles();
  const empty = all.length === 0;
  const [expanded, setExpanded] = useState(false);
  const [contentH, setContentH] = useState(0);
  const limit = MEMO_LINES * st.memoLine;
  // 문단은 적어도 한 줄이라, 접어 둘 때는 보이는 만큼(+1)만 그린다(문단 200개짜리 메모도 폴더를 바꿀 때 8개만. 2026-10-18 측정)
  const many = paragraphs.length > SHOWN_WHEN_FOLDED;
  const long = many || contentH > limit + 4;
  const editingHere = !!editing && paragraphs.some((p) => p.id === editing.id);
  const open = expanded || editingHere || !long;
  // 접힌 채 이어 쓰는 중이면 끝부분, 아니면 앞부분
  const from = open || !many ? 0 : showCaret ? paragraphs.length - SHOWN_WHEN_FOLDED : 0;
  const shown = open || !many ? paragraphs : paragraphs.slice(from, from + SHOWN_WHEN_FOLDED);
  const z = theme.zoom;
  const pad = z === 1 ? null : { paddingHorizontal: 22.5 * z, paddingTop: 14 * z, paddingBottom: 17 * z };

  // 비었거나 빈 문단만 남은 메모: 누르면 아래 입력창 대신 이 칸에서 바로 쓴다(빈 문단이 있으면 그 문단에서)
  const blank = !editingHere && all.every((p) => !p.text);
  const writableBlank = all.find((p) => canWrite(p.folder_id));
  if (blank && !showCaret) {
    return (
      <Pressable
        onPress={writableBlank ? () => setEditing({ id: writableBlank.id, caret: 0 }) : onEmptyPress}
        disabled={!writableBlank && !onEmptyPress}
        accessibilityRole="button"
        accessibilityLabel={t('continueMemo')}
        // 글을 쓰기 전과 같은 칸 크기(PC 여백 포함): 쓰기 시작해도 높이가 바뀌지 않게
        style={[styles.memo, theme.desk && styles.memoDesk, pad, { backgroundColor: theme.todoCard }]}
      >
        <Text style={[st.memo, { color: theme.subtle }]}>{t('memoEmpty')}</Text>
      </Pressable>
    );
  }
  // 빈 메모에 이어 쓰는 중이어도 평소 메모 칸 그대로(예전엔 테두리만 있는 칸으로 바꿨다. 할 일 미리보기 박스를 없애며 맞춤, 사용자 요청 2026-10-19)
  return (
    <View style={[styles.memo, theme.desk && styles.memoDesk, pad, { backgroundColor: theme.todoCard }]}>
      <View style={[!open && { maxHeight: limit, overflow: 'hidden', justifyContent: showCaret ? 'flex-end' : 'flex-start' }]}>
        <View onLayout={(e) => setContentH(e.nativeEvent.layout.height)}>
          {shown.map((p, i) => {
            const prev = paragraphs[from + i - 1];
            return (
              <View key={p.id}>
                <EditableText
                  id={p.id}
                  text={p.text}
                  editing={editing?.id === p.id ? { caret: editing.caret } : null}
                  readOnly={!canWrite(p.folder_id)}
                  style={st.memo}
                  onStartEdit={(caret) => setEditing({ id: p.id, caret })}
                  onEndEdit={() => setEditing(null)}
                  onSave={(text) => repo.setParagraphText(p.id, text)}
                  onLongPress={() => onLongPressParagraph(p)}
                  onSplit={async (before, after, caret) => {
                    const ids = await repo.splitParagraph(p.id, before, after);
                    if (ids.length) setEditing({ id: ids[ids.length - 1], caret });
                  }}
                  onMergeBack={
                    prev && canWrite(prev.folder_id)
                      ? async (text) => {
                          const caret = prev.text.length;
                          await repo.setParagraphText(p.id, text);
                          await repo.mergeParagraphInto(prev.id, p.id);
                          setEditing({ id: prev.id, caret });
                        }
                      : undefined
                  }
                />
                {p.conflict_of ? <Text style={theme.font(12, { color: theme.muted, marginBottom: 4 })}>{t('conflictCopy')}</Text> : null}
              </View>
            );
          })}
          {showCaret ? <InsertCaret placeholder={empty ? t('continueMemo') : ''} /> : null}
        </View>
      </View>
      {long && !editingHere ? (
        <Pressable
          onPress={() => setExpanded(!expanded)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          style={styles.more}
        >
          <Text style={theme.font(15 * z, { color: theme.accent })}>{expanded ? t('memoLess') : t('memoMore')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

/** 접혔을 때 보이는 메모 줄 수 */
const MEMO_LINES = 7;
const SHOWN_WHEN_FOLDED = MEMO_LINES + 1;

/** 메모 모드에서 '여기에 이어 쓴다'는 위치 표시. 실제 포커스는 입력창에만 있다. */
function InsertCaret({ placeholder }: { placeholder: string }) {
  const { theme, filter } = useApp();
  const draft = useDrafts().draftOf(filter, false);
  const st = useCardStyles();
  const [blink] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 500, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(blink, { toValue: 1, duration: 500, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink]);
  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.caretRow}>
      <Text style={[st.memo, { color: theme.muted }]}>
        {draft || placeholder}
        <Text> </Text>
      </Text>
      <Animated.View
        style={[styles.caret, { opacity: blink, backgroundColor: theme.accent, height: Math.round(24 * theme.zoom * theme.scale) }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // 모서리는 시안에서 잰 값(할 일 14.5, 메모 16)
  // 카드 사이 간격은 바깥(SwipeToDelete)이 맡는다: 밀 때 드러나는 빨간 바탕이 간격까지 덮지 않게
  card: { borderRadius: 14.5, flexDirection: 'row', alignItems: 'center' },
  circle: { borderWidth: 1.6, alignItems: 'center', justifyContent: 'center' },
  // 보조 줄: 한 줄이 기본, 좁은 창·큰 글자에서는 잘리거나 겹치지 않게 그 안에서 줄바꿈
  metaRow: { flexDirection: 'row', alignItems: 'flex-start' },
  repeat: { flexDirection: 'row', alignItems: 'flex-start', flexShrink: 1 },
  metaText: { flexShrink: 1 },
  memo: { borderRadius: 16, paddingHorizontal: 22.5, paddingTop: 14, paddingBottom: 17, marginBottom: 9.5 },
  // PC 큰 창(시안): 안쪽 16.7, 블록 사이 12
  memoDesk: { borderRadius: 12, paddingLeft: 16.7, paddingRight: 16.7, paddingTop: 12, paddingBottom: 9, marginBottom: 12 },
  more: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 4 },
  caretRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  caret: { width: 2, borderRadius: 1, marginLeft: -2 },
  doneHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingTop: 22, paddingBottom: 12 },
});
