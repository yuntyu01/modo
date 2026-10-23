import { compareKey } from '../../core/frac';
import { toPlain } from '../../core/rich';
import type { Folder, FolderFilter, Paragraph, Snapshot, Todo } from '../../core/types';

export type Block =
  | { kind: 'todo'; key: string; sort: string; todo: Todo }
  /** 완료 묶음 머리 '완료 N'. count는 묶음에 보이는 개수, clearable은 '완료 비우기'로 지울 보통 할 일이 보이는지 */
  | { kind: 'done'; key: 'done'; sort: ''; count: number; clearable: boolean };

/** 지워지지 않은 폴더(화면·탭에 보이는 순서 그대로) */
export const liveFolders = (folders: Folder[]) => folders.filter((f) => !f.deleted_at);

/** 살아 있는 폴더 id 모음. 여기에 없는 폴더를 가리키는 항목은 기본 폴더로 본다(잃어버리지 않게). */
export function liveFolderIds(folders: Folder[]) {
  return new Set(liveFolders(folders).map((f) => f.id));
}

/** 휴지통에 있는 할 일·문단 수(홈 ⋯ 메뉴, 설정, 미니창이 같은 식을 따로 갖고 있었다) */
export function countTrash(snap: Pick<Snapshot, 'todos' | 'paragraphs'>) {
  let n = 0;
  for (const x of snap.todos) if (x.deleted_at) n++;
  for (const x of snap.paragraphs) if (x.deleted_at) n++;
  return n;
}

/** 항목이 실제로 속한 폴더(null = 폴더 없음, 전체 탭의 메모·추가 자리) */
export function homeFolder(folderId: string | null, live: Set<string>): FolderFilter {
  return folderId && live.has(folderId) ? folderId : null;
}

/** 홈에서 숨긴 공유 폴더(함께 탭에서만 본다) */
export function hiddenFolderIds(shared: Snapshot['shared']) {
  return new Set(shared.filter((s) => !s.home).map((s) => s.folder_id));
}

/**
 * 할 일이 지금 보는 탭에 들어가는지. 전체(filter = null, 예전 '기본' 폴더)는 홈에 보이는 모든 폴더의 할 일 + 폴더 없는 할 일
 * (사용자 요청 2026-10-24), 폴더 탭은 그 폴더 것만. 메모는 전체에서도 폴더 없는 메모만(visibleParagraphs)
 */
export function todoInView(folderId: string | null, filter: FolderFilter, live: Set<string>, hidden: Set<string>) {
  if (filter === null) return !(folderId && live.has(folderId) && hidden.has(folderId));
  return homeFolder(folderId, live) === filter;
}

/** 전체 탭에서 할 일 아래 줄에 붙일 폴더 이름(폴더 없는 할 일은 없음) */
export function folderLabelOf(folderId: string | null, folders: Folder[]) {
  return folderId ? folders.find((f) => f.id === folderId && !f.deleted_at)?.name : undefined;
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

/** 완료한 할 일은 아래 '완료' 묶음으로 보낸다. 최근에 완료한 순서. */
export function splitDone<T extends Pick<Todo, 'done' | 'done_at' | 'position' | 'id'>>(todos: T[]): [T[], T[]] {
  // done: 반복 할 일은 다음 예정일이 오기 전까지만 완료(repo.isDoneNow)
  const open = todos.filter((t) => !t.done);
  const done = todos
    .filter((t) => t.done)
    .sort((a, b) => b.done_at! - a.done_at! || compareKey(a.position, b.position) || compareKey(a.id, b.id));
  return [open, done];
}

/** 끌어서 순서를 바꿀 수 있는 블록(완료 묶음과 그 머리는 제외) */
export const isOrdered = (b: Block) => b.kind === 'todo' && !b.todo.done;

/**
 * 반복 할 일은 완료하면 다음 예정일로 넘어가 그날 다시 올라온다. 그 전까지는 체크된 채로 완료 묶음 맨 위에(완료 항목을 숨겨도 보인다).
 * 처음부터 앞날에 시작하는 반복(아직 한 번도 안 한 것)도 목록에 보인다(아래 줄 '매월 20일 · 10월 20일').
 * 예전엔 그날까지 캘린더에서만 보여, 매월 반복을 만들면 목록에서 사라진 것처럼 보였다(사용자 제보 2026-10-18).
 */
export const isRepeatDone = (t: Pick<Todo, 'done' | 'repeat_freq'>) => t.done && !!t.repeat_freq;

function matches(text: string, q: string) {
  return !q || text.toLowerCase().includes(q.toLowerCase());
}

/** 그 폴더의 메모 문단(찾는 중이면 찾은 것만). 홈은 할 일과 따로 memo한다(할 일을 저장해도 문단 배열이 새로 생기지 않게) */
export function visibleParagraphs(snap: Pick<Snapshot, 'paragraphs' | 'folders'>, filter: FolderFilter, query: string): Paragraph[] {
  const live = liveFolderIds(snap.folders);
  return snap.paragraphs.filter((p) => !p.deleted_at && homeFolder(p.folder_id, live) === filter && (!query || matches(toPlain(p.text), query)));
}

/**
 * 폴더 화면 구성: 그 폴더의 메모 문단들(메모 카드 하나)과 그 폴더의 할 일.
 * 예전엔 할 일 모드로 입력 중이면 들어갈 자리에 테두리만 있는 미리보기 카드를 끼웠는데, 입력창에만 쓰면 된다고 해서 뺐다
 * (사용자 요청 2026-10-19. 메모 모드의 이어 쓸 자리 커서는 어디에 쓰는지 보이게 남겼다).
 */
export function buildBlocks(args: { snap: Snapshot; filter: FolderFilter; showDone: boolean; query: string }) {
  const { snap, filter, showDone, query } = args;
  const live = liveFolderIds(snap.folders);
  const hidden = hiddenFolderIds(snap.shared);
  const all = snap.todos.filter((t) => !t.deleted_at && todoInView(t.folder_id, filter, live, hidden) && matches(toPlain(t.text), query));
  // 완료 항목을 숨기면(⋯ 메뉴) 보통 할 일만 숨는다. 완료한 반복 할 일은 다음 회차까지 묶음 맨 위에 체크된 채로 보인다
  // (매월 반복을 만들면 목록에서 사라진 것처럼 보였다, 사용자 제보 2026-10-18). 찾는 중이면 다 보인다.
  const doneOpen = showDone || !!query;
  const todos = all.filter((t) => doneOpen || !t.done || isRepeatDone(t));
  const paragraphs = visibleParagraphs(snap, filter, query);
  const [open, finished] = splitDone(todos);
  const done = [...finished.filter(isRepeatDone), ...finished.filter((t) => !isRepeatDone(t))];
  const blocks: Block[] = open.map((t) => ({ kind: 'todo', key: t.id, sort: t.position, todo: t }));
  blocks.sort((a, b) => compareKey(a.sort, b.sort));
  // 완료한 할 일은 진행 중 목록 아래 '완료 N' 묶음에: 반복 할 일 먼저, 그다음 보통 할 일(각각 최근 완료 순).
  // N은 묶음에 보이는 개수. 지울 보통 할 일이 보이면 머리에 '완료 비우기'(반복 할 일은 다음 회차가 있어 지우지 않는다)
  if (done.length) blocks.push({ kind: 'done', key: 'done', sort: '', count: done.length, clearable: done.some((t) => !isRepeatDone(t)) });
  for (const t of done) blocks.push({ kind: 'todo', key: t.id, sort: t.position, todo: t });
  return { blocks, paragraphs, todos };
}

/** 끌어서 놓은 자리의 앞뒤 정렬 키(완료 묶음은 건너뛴다). 완료 묶음 안에 놓으면 진행 중 목록의 맨 끝. */
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
