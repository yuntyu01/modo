import { randomUUID } from 'node:crypto';

import { Repo, type Touched } from '../repo';
import { SyncEngine } from '../sync';
import { memoryDb } from './sqljsDb';

// 성능 정리(2026-10-18)의 회귀 시험: 바뀐 표만 다시 읽기, 빈 동기화가 쓰기·알림을 만들지 않기, 창 연결이 outbox를 건드리지 않기

async function setup() {
  const db = await memoryDb();
  const repo = new Repo(db, randomUUID);
  await repo.init();
  const events: { source: string; tables: string[] }[] = [];
  repo.subscribe((source, tables: Touched) => events.push({ source, tables: [...tables].sort() }));
  return { repo, db, events };
}

test('쓰기마다 실제로 바꾼 표를 알린다(kv만 바꾼 쓰기는 화면 표를 건드리지 않는다)', async () => {
  const { repo, events } = await setup();
  const id = await repo.addTodo('영양제 먹기', null, 'bottom');
  expect(events.pop()).toEqual({ source: 'local', tables: ['outbox', 'todos'] });
  await repo.write(() => repo.setKv('session', { lastFolder: null }));
  expect(events.pop()).toEqual({ source: 'local', tables: ['kv'] });
  // 같은 값으로 고치면 아무 표도 안 바뀌어 알리지 않는다
  const n = events.length;
  await repo.setTodoText(id, '영양제 먹기');
  expect(events.length).toBe(n);
});

test('바뀐 표만 다시 읽고 나머지는 지난 배열을 그대로 쓴다', async () => {
  const { repo } = await setup();
  await repo.addTodo('할 일', null, 'bottom');
  await repo.appendParagraphs('메모', null);
  const a = await repo.snapshot();
  const [pid] = await repo.appendParagraphs('둘째 줄', null);
  const b = await repo.snapshot(new Set(['paragraphs', 'outbox']));
  expect(b.todos).toBe(a.todos); // 할 일은 다시 읽지 않았다
  expect(b.paragraphs.map((p) => p.id)).toContain(pid);
  // kv만 바뀌면 같은 스냅샷 객체(화면이 다시 그려지지 않는다)
  expect(await repo.snapshot(new Set(['kv']))).toBe(b);
});

test('변경 없는 동기화는 DB에 쓰지 않고 화면에도 알리지 않는다(30초마다 도는 것)', async () => {
  const { repo, events } = await setup();
  const fakeFetch = (async (url: string) => {
    if (url.includes('/api/sync/pull')) return new Response(JSON.stringify({ folders: [], todos: [], paragraphs: [], deleted: [], cursor: 5, more: false, shared: [], foreign_ids: [] }));
    return new Response(JSON.stringify({ results: [] }));
  }) as typeof fetch;
  const sync = new SyncEngine(repo, fakeFetch, 'test');
  await repo.write(() => repo.setKv('account', { id: 'u', email: '', token: 't', server: 'http://s' }));
  const statuses: string[] = [];
  sync.onStatus((s) => statuses.push(s.state));
  await sync.syncNow(); // 첫 번: 커서 0 → 5를 기록
  const after1 = events.length;
  await sync.syncNow();
  await sync.syncNow();
  expect(events.length).toBe(after1); // 두 번째부터는 쓰기도 알림도 없다
  // 상태도 바뀐 것만(syncing ↔ idle). 같은 상태를 거듭 알리지 않는다
  expect(statuses.filter((s, i) => s === statuses[i - 1])).toEqual([]);
});

test('공유 목록이 그대로면 공유 표를 지우고 다시 넣지 않는다', async () => {
  const { repo, events } = await setup();
  const shared = [{ folder_id: 'f1', role: 'edit' as const, owner: { id: 'o1', email: 'o@x', name: '주인' } }];
  await repo.sweepForeign([], shared);
  expect(events.pop()?.tables).toEqual(expect.arrayContaining(['people', 'shared_folders']));
  const n = events.length;
  await repo.sweepForeign([], shared);
  expect(events.length).toBe(n);
  // 권한이 바뀌면 다시 쓴다
  await repo.sweepForeign([], [{ ...shared[0], role: 'view' }]);
  expect(events.length).toBe(n + 1);
  expect((await repo.snapshot()).shared[0].role).toBe('view');
});

test('동기화하지 않는 연결(PC 창)은 init에서 보내는 중인 op를 풀지 않는다', async () => {
  const db = await memoryDb();
  const owner = new Repo(db, randomUUID);
  await owner.init();
  await owner.addTodo('보내는 중', null, 'bottom');
  const taken = await owner.takeOutbox(10); // 메인이 보내는 중
  expect(taken).toHaveLength(1);
  const windowRepo = new Repo(db, randomUUID);
  await windowRepo.init({ owner: false }); // 창이 새로 열림
  const [row] = await db.all<{ inflight: number }>(`SELECT inflight FROM outbox`);
  expect(row.inflight).toBe(1);
  // 동기화 주인이 다시 켜질 때(앱이 죽었다 켜짐)만 다시 보낼 수 있게 푼다
  await new Repo(db, randomUUID).init();
  expect((await db.all<{ inflight: number }>(`SELECT inflight FROM outbox`))[0].inflight).toBe(0);
});
