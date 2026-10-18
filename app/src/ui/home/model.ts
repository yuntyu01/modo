import { compareKey, keyBetween } from '../../core/frac';
import type { Folder, FolderFilter, Paragraph, Snapshot, Todo } from '../../core/types';
import type { Prefs } from '../../state/prefs';
import { localDate } from '../format';

export type Block =
  | { kind: 'todo'; key: string; sort: string; todo: Todo }
  | { kind: 'preview'; key: 'preview'; sort: string };

/** 살아 있는 폴더 id 모음. 여기에 없는 폴더를 가리키는 항목은 기본 폴더로 본다(잃어버리지 않게). */
export function liveFolderIds(folders: Folder[]) {
  return new Set(folders.filter((f) => !f.deleted_at).map((f) => f.id));
}

/** 항목이 실제로 속한 폴더(null = 기본) */
export function homeFolder(folderId: string | null, live: Set<string>): FolderFilter {
  return folderId && live.has(folderId) ? folderId : null;
}

/**
 * 메모 끝에 이어진 빈 문단은 화면에 그리지 않는다(엔터만 여러 번 눌러 생긴 빈 줄이 메모 칸을 길게 늘려 아래 할 일을 밀어냈다).
 * 데이터는 그대로 두고, 그 빈 문단을 고치는 중이면 거기까지 보인다. 모두 비었으면 빈 메모로 보인다.
 */
export function trimTrailingBlank<T extends { id: string; text: string }>(paragraphs: T[], editingId?: string | null): T[] {
  let end = paragraphs.length;
  while (end > 0 && !paragraphs[end - 1].text) end--;
  const editAt = editingId ? paragraphs.findIndex((p) => p.id === editingId) : -1;
  end = Math.max(end, editAt + 1);
  return end === paragraphs.length ? paragraphs : paragraphs.slice(0, end);
}

/** 완료한 할 일은 아래 '완료' 묶음으로 보낸다. 묶음 안은 최근에 완료한 순서. */
export function splitDone<T extends Pick<Todo, 'done' | 'done_at' | 'position' | 'id'>>(todos: T[]): [T[], T[]] {
  // done: 반복 할 일은 다음 예정일이 오기 전까지만 완료(repo.isDoneNow)
  const open = todos.filter((t) => !t.done);
  const done = todos
    .filter((t) => t.done)
    .sort((a, b) => b.done_at! - a.done_at! || compareKey(a.position, b.position) || compareKey(a.id, b.id));
  return [open, done];
}

/** 끌어서 순서를 바꿀 수 있는 블록(완료 묶음과 미리보기는 제외) */
export const isOrdered = (b: Block) => b.kind === 'todo' && !b.todo.done;

/**
 * 반복 할 일은 완료하면 다음 예정일로 넘어가 그날 다시 올라온다. 그 전까지는 체크된 채로 목록 맨 아래에(완료 묶음),
 * 처음부터 앞날에 시작하는 반복(아직 한 번도 안 한 것)은 그날까지 캘린더에서만 보인다.
 */
export const isRepeatDone = (t: Pick<Todo, 'done' | 'repeat_freq'>) => t.done && !!t.repeat_freq;

export function isUpcomingRepeat(t: Pick<Todo, 'repeat_freq' | 'due_date'>, today: string) {
  return !!t.repeat_freq && !!t.due_date && t.due_date > today;
}

function matches(text: string, q: string) {
  return !q || text.toLowerCase().includes(q.toLowerCase());
}

/**
 * 폴더 화면 구성: 그 폴더의 메모 문단들(메모 카드 하나)과 그 폴더의 할 일.
 * 할 일 모드로 입력 중이면 실제로 들어갈 자리에 미리보기 카드를 끼운다(저장하지 않음).
 */
export function buildBlocks(args: {
  snap: Snapshot;
  filter: FolderFilter;
  prefs: Prefs;
  query: string;
  todoMode: boolean;
  composing: boolean;
}) {
  const { snap, filter, prefs, query, todoMode, composing } = args;
  const live = liveFolderIds(snap.folders);
  const inView = (folderId: string | null) => homeFolder(folderId, live) === filter;
  const today = localDate(new Date());
  const todos = snap.todos.filter(
    (t) =>
      !t.deleted_at &&
      inView(t.folder_id) &&
      // 완료한 반복 할 일은 '완료 항목 숨기기'여도 다음 회차까지 맨 아래에 체크된 채로 보인다
      (prefs.showDone || !t.done || isRepeatDone(t) || !!query) &&
      (!!query || isRepeatDone(t) || !isUpcomingRepeat(t, today)) &&
      matches(t.text, query),
  );
  const paragraphs: Paragraph[] = snap.paragraphs.filter(
    (p) => !p.deleted_at && inView(p.folder_id) && (!query || matches(p.text, query)),
  );
  const [open, done] = splitDone(todos);
  const blocks: Block[] = open.map((t) => ({ kind: 'todo', key: t.id, sort: t.position, todo: t }));
  if (todoMode && composing && !query) {
    // 저장소의 addTodo와 같은 규칙으로 실제로 들어갈 자리를 계산한다.
    const all = snap.todos.map((t) => t.position).sort(compareKey);
    const sort = prefs.newTodoAt === 'top' ? keyBetween(null, all[0] ?? null) : keyBetween(all[all.length - 1] ?? null, null);
    blocks.push({ kind: 'preview', key: 'preview', sort });
  }
  blocks.sort((a, b) => compareKey(a.sort, b.sort) || (a.kind === 'preview' ? 1 : 0) - (b.kind === 'preview' ? 1 : 0));
  // 완료한 할 일은 머리글 없이 진행 중 목록 아래에(최근 완료 순)
  for (const t of done) blocks.push({ kind: 'todo', key: t.id, sort: t.position, todo: t });
  return { blocks, paragraphs, todos };
}

/** 끌어서 놓은 자리의 앞뒤 정렬 키(미리보기 카드와 완료 묶음은 건너뛴다). 완료 묶음 안에 놓으면 진행 중 목록의 맨 끝. */
export function neighborKeys(blocks: Block[], to: number): [string | null, string | null] {
  const real = (i: number, dir: -1 | 1) => {
    for (let j = i; j >= 0 && j < blocks.length; j += dir) if (j !== to && isOrdered(blocks[j])) return blocks[j];
    return null;
  };
  const prev = real(to - 1, -1)?.sort || null;
  let next = real(to + 1, 1)?.sort || null;
  if (prev && next && prev >= next) next = null;
  return [prev, next];
}
