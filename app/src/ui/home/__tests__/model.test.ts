import type { Folder, Paragraph, Snapshot, Todo } from '../../../core/types';
import { buildBlocks, folderLabelOf, neighborKeys, trimTrailingBlank } from '../model';

const todo = (id: string, position: string, done_at: number | null = null, folder_id: string | null = null): Todo => ({
  id, folder_id, text: id, done: done_at != null, done_at, due_date: null, remind_at: null, repeat_freq: null, repeat_days: null, position,
  created_at: 0, updated_at: 0, deleted_at: null, conflict_of: null,
});
const para = (id: string, position: string, folder_id: string | null): Paragraph => ({
  id, folder_id, text: id, position, created_at: 0, updated_at: 0, deleted_at: null, conflict_of: null,
});
const folder = (id: string, deleted = false): Folder => ({
  id, name: id, position: id, created_at: 0, updated_at: 0, deleted_at: deleted ? 1 : null,
} as Folder);

const build = (o: { todos?: Todo[]; paragraphs?: Paragraph[]; folders?: Folder[]; filter?: string | null; showDone?: boolean }) =>
  buildBlocks({
    snap: { folders: o.folders ?? [], todos: o.todos ?? [], paragraphs: o.paragraphs ?? [], shared: [] } as Snapshot,
    filter: o.filter ?? null,
    showDone: o.showDone ?? true,
    query: '',
  });

test('완료한 할 일은 아래 "완료 N" 묶음에, 최근에 완료한 것부터', () => {
  const { blocks } = build({ todos: [todo('a', 'a0', 100), todo('b', 'a1'), todo('c', 'a2', 300), todo('d', 'a3')] });
  expect(blocks.map((b) => b.key)).toEqual(['b', 'd', 'done', 'c', 'a']);
  expect(blocks[2]).toMatchObject({ kind: 'done', count: 2, clearable: true });
});

test('완료 항목을 숨기면(⋯ 메뉴) 보이는 완료가 없어 묶음 머리도 없다', () => {
  const { blocks } = build({ todos: [todo('a', 'a0', 100), todo('b', 'a1')], showDone: false });
  expect(blocks.map((b) => b.key)).toEqual(['b']);
});

test('완료한 할 일이 없으면 묶음 머리도 없다', () => {
  expect(build({ todos: [todo('a', 'a0'), todo('b', 'a1')] }).blocks.map((b) => b.key)).toEqual(['a', 'b']);
});

test('완료 묶음 안에 끌어다 놓으면 진행 중 목록의 맨 끝', () => {
  const { blocks } = build({ todos: [todo('a', 'a0'), todo('b', 'a1'), todo('c', 'a2', 1)] });
  // [a, b, 완료 머리, c]에서 a를 맨 끝(완료 묶음 안)으로
  const moved = [blocks[1], blocks[2], blocks[3], blocks[0]];
  expect(neighborKeys(moved, 3)).toEqual(['a1', null]);
});

describe('폴더마다 메모 하나 + 그 폴더의 할 일', () => {
  const folders = [folder('work'), folder('home'), folder('gone', true)];
  const todos = [todo('t-base', 'a0'), todo('t-work', 'a1', null, 'work'), todo('t-home', 'a2', null, 'home'), todo('t-gone', 'a3', null, 'gone')];
  const paragraphs = [para('p-base', 'a0', null), para('p-work', 'a1', 'work'), para('p-work2', 'a2', 'work'), para('p-home', 'a3', 'home')];

  test('업무 폴더는 업무 메모와 업무 할 일만', () => {
    const r = build({ folders, todos, paragraphs, filter: 'work' });
    expect(r.blocks.map((b) => b.key)).toEqual(['t-work']);
    expect(r.paragraphs.map((p) => p.id)).toEqual(['p-work', 'p-work2']);
  });

  test('전체(예전 기본)는 모든 폴더의 할 일 + 폴더 없는 할 일, 메모는 폴더 없는 메모만(다른 폴더 메모는 복제하지 않는다)', () => {
    const r = build({ folders, todos, paragraphs, filter: null });
    expect(r.blocks.map((b) => b.key)).toEqual(['t-base', 't-work', 't-home', 't-gone']);
    expect(r.paragraphs.map((p) => p.id)).toEqual(['p-base']);
    // 홈에서 숨긴 공유 폴더의 할 일은 전체에도 없다(함께 탭에서 본다)
    const hidden = buildBlocks({
      snap: { folders, todos, paragraphs, shared: [{ folder_id: 'home', role: 'edit', owner: { id: 'o', email: '', name: '' }, home: false }] } as Snapshot,
      filter: null,
      showDone: true,
      query: '',
    });
    expect(hidden.blocks.map((b) => b.key)).toEqual(['t-base', 't-work', 't-gone']);
    expect(folderLabelOf('work', folders)).toBe('work');
    expect([folderLabelOf(null, folders), folderLabelOf('gone', folders)]).toEqual([undefined, undefined]);
  });
});

test('앞날에 시작하는 반복 할 일도 폴더 화면에 보인다(매월 반복이 사라진 것처럼 보이지 않게), 검색도 된다', () => {
  const today = new Date();
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tomorrow = fmt(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  const due: Todo = { ...todo('a', 'a0'), repeat_freq: 'daily', due_date: fmt(today) };
  const later: Todo = { ...todo('b', 'a1'), repeat_freq: 'daily', due_date: tomorrow };
  const plain: Todo = { ...todo('c', 'a2'), due_date: tomorrow };
  const snap: Snapshot = { folders: [], todos: [due, later, plain], paragraphs: [], shared: [] };
  const base = { snap, filter: null, showDone: true };
  expect(buildBlocks({ ...base, query: '' }).blocks.map((b) => b.key)).toEqual(['a', 'b', 'c']);
  expect(buildBlocks({ ...base, query: 'b' }).blocks.map((b) => b.key)).toEqual(['b']);
});

test('이번 회차를 끝낸 반복 할 일은 다음 예정일까지 체크된 채 완료 묶음 맨 위에(숨겨도 보인다)', () => {
  const today = new Date();
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tomorrow = fmt(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  // 체크해서 내일로 넘어간 반복(done = 그날까지 완료), 끝낸 보통 할 일, 남은 할 일
  const repeatDone: Todo = { ...todo('r', 'a0', 500), repeat_freq: 'daily', due_date: tomorrow };
  // 보통 할 일을 더 나중에 끝냈어도 반복이 먼저
  const plainDone = todo('p', 'a1', 600);
  const open = todo('o', 'a2');
  const hidden = build({ todos: [repeatDone, plainDone, open], showDone: false }).blocks;
  expect(hidden.map((b) => b.key)).toEqual(['o', 'done', 'r']);
  // 숨긴 동안 보이는 건 반복뿐이라 개수는 1, 지울 것도 없다(반복은 지우지 않는다)
  expect(hidden[1]).toMatchObject({ count: 1, clearable: false });
  const shown = build({ todos: [repeatDone, plainDone, open], showDone: true }).blocks;
  expect(shown.map((b) => b.key)).toEqual(['o', 'done', 'r', 'p']);
  expect(shown[1]).toMatchObject({ count: 2, clearable: true });
});

test('메모 끝에 이어진 빈 문단은 그리지 않는다(데이터는 그대로, 고치는 중이면 거기까지)', () => {
  const p = (id: string, text: string) => ({ id, text });
  const list = [p('a', '오늘은'), p('b', ''), p('c', '내일'), p('d', ''), p('e', '')];
  expect(trimTrailingBlank(list).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  expect(trimTrailingBlank(list, 'e').map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect(trimTrailingBlank([p('a', ''), p('b', '')])).toEqual([]);
  // 지울 빈 줄이 없으면 같은 배열(다시 그리지 않게)
  const clean = list.slice(0, 3);
  expect(trimTrailingBlank(clean)).toBe(clean);
});
