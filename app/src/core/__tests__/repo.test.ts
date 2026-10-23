import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { keyBetween } from '../frac';
import { Repo } from '../repo';
import { SCHEMA } from '../schema';
import { memoryDb } from './sqljsDb';

async function setup() {
  let t = 1000;
  const db = await memoryDb();
  const repo = new Repo(db, randomUUID, () => t);
  await repo.init();
  return { repo, db, tick: (n = 1000) => (t += n) };
}

const outbox = async (repo: Repo) =>
  (await repo.db.all<{ entity_id: string; fields: string; is_create: number }>(`SELECT * FROM outbox ORDER BY seq`)).map(
    (r) => ({ ...r, fields: JSON.parse(r.fields) }),
  );

test('같은 항목의 연속 편집은 큐에서 하나로 합쳐지고 처음 old를 유지한다', async () => {
  const { repo } = await setup();
  const id = await repo.addTodo('회의', null, 'bottom');
  await repo.db.run(`DELETE FROM outbox`); // 이미 보냈다고 치자
  await repo.setTodoText(id, '회의 자');
  await repo.setTodoText(id, '회의 자료 정리');
  const ob = await outbox(repo);
  expect(ob).toHaveLength(1);
  expect(ob[0].fields.text).toEqual({ old: '회의', new: '회의 자료 정리' });
  // 원래대로 되돌리면 보낼 것이 없다
  await repo.setTodoText(id, '회의');
  expect(await outbox(repo)).toHaveLength(0);
});

test('수정 시각은 내용이 바뀔 때만 갱신된다', async () => {
  const { repo, tick } = await setup();
  const id = await repo.addTodo('책 20쪽 읽기', null, 'bottom');
  tick();
  await repo.setTodoText(id, '책 20쪽 읽기'); // 같은 값
  await repo.setDone(id, true); // 완료는 내용 변경 아님
  let t = (await repo.snapshot()).todos[0];
  expect(t.updated_at).toBe(1000);
  expect(t.done_at).toBe(2000);
  tick();
  await repo.setTodoText(id, '책 30쪽 읽기');
  t = (await repo.snapshot()).todos[0];
  expect(t.updated_at).toBe(3000);
});

test('캘린더에서 추가한 할 일은 그 날짜가 붙고 같이 동기화된다', async () => {
  const { repo } = await setup();
  const id = await repo.addTodo('발표 준비', 'f1', 'bottom', '2026-10-21');
  const t = (await repo.snapshot()).todos.find((x) => x.id === id)!;
  expect(t.due_date).toBe('2026-10-21');
  expect(t.folder_id).toBe('f1');
  const ob = await outbox(repo);
  expect(ob[0].is_create).toBe(1);
  expect(ob[0].fields.due_date).toEqual({ old: null, new: '2026-10-21' });
});

test('반복 할 일은 그날이 되면 한 번 맨 위로 올라온다(끌어 내리면 그대로, 다음 회차에 다시)', async () => {
  const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
  let now = day(2026, 10, 19);
  const db = await memoryDb();
  const repo = new Repo(db, randomUUID, () => now);
  await repo.init();
  const a = await repo.addTodo('보고서', null, 'bottom');
  const b = await repo.addTodo('매일 운동', null, 'bottom');
  const c = await repo.addTodo('매주 수요일 청소', null, 'bottom');
  await repo.setRepeat(b, { freq: 'daily', days: null }, '2026-10-19');
  await repo.setRepeat(c, { freq: 'weekly', days: 4 }, '2026-10-19');
  const order = async () => (await repo.snapshot()).todos.filter((t) => !t.done).map((t) => t.text);
  // 오늘 정한 반복은 그대로(방금 고쳤다)
  expect(await repo.liftDueRepeats()).toBe(0);
  await repo.complete(b); // 내일 다시
  now = day(2026, 10, 20, 0) + 5000; // 자정 지나 5초
  expect(await repo.liftDueRepeats()).toBe(1);
  expect(await order()).toEqual(['매일 운동', '보고서', '매주 수요일 청소']); // 청소는 아직 앞날(처음 회차 전)이라 그 자리
  // 한 번만: 다시 불러도, 끌어 내려도 그대로
  expect(await repo.liftDueRepeats()).toBe(0);
  const snap = await repo.snapshot();
  const pa = snap.todos.find((t) => t.id === a)!.position;
  await repo.moveTo('todo', b, pa, null);
  expect(await repo.liftDueRepeats()).toBe(0);
  expect(await order()).toEqual(['보고서', '매일 운동', '매주 수요일 청소']);
  // 수요일: 운동은 아직 안 했고(이미 올렸던 회차) 청소가 처음 그날이 와 올라온다. 동기화 큐에 순서와 수정 시각이 실린다
  now = day(2026, 10, 21, 7);
  await repo.db.run(`DELETE FROM outbox`);
  expect(await repo.liftDueRepeats()).toBe(1);
  expect(await order()).toEqual(['매주 수요일 청소', '보고서', '매일 운동']);
  const ob = await outbox(repo);
  expect(ob.map((o) => Object.keys(o.fields).sort())).toEqual([['position', 'updated_at']]);
  // 둘이 같은 날 오면 원래 순서대로 맨 위에
  await repo.complete(b);
  await repo.complete(c); // 운동 22일, 청소 28일
  now = day(2026, 10, 28, 9);
  expect(await repo.liftDueRepeats()).toBe(2);
  expect(await order()).toEqual(['매주 수요일 청소', '매일 운동', '보고서']);
});

test('반복 할 일: 정하면 첫 예정일로, 체크하면 다음 예정일로 넘어가 그날까지만 완료(체크된 채 아래), 그날이 되면 다시 할 일', async () => {
  const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
  let now = day(2026, 10, 16); // 금요일
  const db = await memoryDb();
  const repo = new Repo(db, randomUUID, () => now);
  await repo.init();
  const id = await repo.addTodo('책 20분 읽기', null, 'bottom');
  await repo.setRemind(id, day(2026, 10, 16, 21));
  // 월·수·금, 시작일 토요일 → 그 뒤 첫 월요일부터 보이고 알림도 월요일 21시로
  await repo.setRepeat(id, { freq: 'weekly', days: 1 | 4 | 16 }, '2026-10-17');
  let t = (await repo.snapshot()).todos[0];
  expect([t.repeat_freq, t.repeat_days, t.due_date]).toEqual(['weekly', 21, '2026-10-19']);
  expect(t.remind_at).toBe(day(2026, 10, 19, 21));
  // 월요일에 체크 → 수요일
  now = day(2026, 10, 19);
  const r = await repo.complete(id);
  t = (await repo.snapshot()).todos[0];
  expect(r?.next).toBe('2026-10-21');
  expect([t.done, t.due_date, t.remind_at]).toEqual([true, '2026-10-21', day(2026, 10, 21, 21)]);
  // 화요일에도 아직 완료, 수요일이 되면 다시 할 일로
  now = day(2026, 10, 20);
  expect((await repo.snapshot()).todos[0].done).toBe(true);
  now = day(2026, 10, 21);
  expect((await repo.snapshot()).todos[0].done).toBe(false);
  // 완료 정리는 반복 할 일을 지우지 않는다
  now = day(2026, 10, 19);
  expect(await repo.clearDone(null)).toEqual([]);
  // 실행 취소
  await repo.undoComplete(id, r!.prev);
  t = (await repo.snapshot()).todos[0];
  expect([t.done, t.due_date, t.remind_at]).toEqual([false, '2026-10-19', day(2026, 10, 19, 21)]);
  // 체크해 둔 것을 풀면 오늘 할 일로(알림도 오늘로), 오늘의 '한 날' 기록도 지운다
  await repo.complete(id);
  expect((await repo.snapshot()).todos[0].done_log).toBe('2026-10-19');
  await repo.reopenRepeat(id);
  t = (await repo.snapshot()).todos[0];
  expect([t.done, t.due_date, t.remind_at, t.done_log]).toEqual([false, '2026-10-19', day(2026, 10, 19, 21), null]);
  // 한 날 기록은 날마다 쌓인다(월·수)
  await repo.complete(id);
  now = day(2026, 10, 21);
  await repo.complete(id);
  expect((await repo.snapshot()).todos[0].done_log).toBe('2026-10-19,2026-10-21');
  now = day(2026, 10, 19);
  // 반복 끄기: 예정일은 그대로, 체크하면 보통 완료
  await repo.setRepeat(id, null, '2026-10-19');
  expect(await repo.complete(id)).toBeNull();
  t = (await repo.snapshot()).todos[0];
  expect([t.repeat_freq, t.repeat_days, t.due_date, t.done]).toEqual([null, null, '2026-10-23', true]);
  // 동기화 큐에 반복 필드가 실린다
  const fields = (await outbox(repo)).flatMap((o) => Object.keys(o.fields));
  expect(fields).toEqual(expect.arrayContaining(['repeat_freq', 'repeat_days']));
});

test('스키마 버전이 오르면 동기화 커서를 처음으로 돌려 새 열을 다시 받는다', async () => {
  const db = await memoryDb();
  const repo = new Repo(db, randomUUID, () => 1000);
  await repo.init();
  await repo.setKv('sync_cursor', 50);
  await repo.init(); // 같은 버전: 그대로
  expect(await repo.getKv('sync_cursor', 0)).toBe(50);
  await db.run(`UPDATE kv SET value = '2' WHERE key = 'schema_version'`);
  await repo.init(); // 예전 버전에서 올라옴
  expect(await repo.getKv('sync_cursor', -1)).toBe(0);
});

test('새 할 일 위/아래 추가', async () => {
  const { repo } = await setup();
  await repo.addTodo('가운데', null, 'bottom');
  await repo.addTodo('아래', null, 'bottom');
  await repo.addTodo('위', null, 'top');
  expect((await repo.snapshot()).todos.map((t) => t.text)).toEqual(['위', '가운데', '아래']);
});

test('폴더를 지워도 내용은 기본 폴더(폴더 없음)로 남는다', async () => {
  const { repo } = await setup();
  const work = await repo.createFolder('업무');
  await repo.addTodo('회의 자료 정리', work, 'bottom');
  await repo.appendParagraphs('배포 일정 확인', work);
  await repo.deleteFolder(work);
  const s = await repo.snapshot();
  expect(s.folders[0].deleted_at).not.toBeNull();
  expect(s.todos[0].folder_id).toBeNull();
  expect(s.paragraphs[0].folder_id).toBeNull();
});

test('이미 보낸 폴더를 지웠다 되돌리면 상쇄되어 큐에 아무것도 남지 않는다(폴더 만들기 op가 뒤에 있을 때만 안 합친다)', async () => {
  const { repo } = await setup();
  const work = await repo.createFolder('업무');
  const ids = [];
  for (const t of ['하나', '둘', '셋']) ids.push(await repo.addTodo(t, work, 'bottom'));
  await repo.db.run(`DELETE FROM outbox`); // 전부 보냈다고 치자
  const moved = await repo.deleteFolder(work);
  await repo.undoDeleteFolder(work, moved);
  expect(await outbox(repo)).toEqual([]);
  // 아직 안 보낸 새 폴더로 옮기는 변경은 그 폴더 만들기 op 뒤에 따로 남는다(서버가 폴더를 먼저 알아야 한다)
  await repo.setTodoText(ids[0], '하나!');
  const fresh = await repo.createFolder('새 폴더');
  await repo.setFolder('todo', ids[0], fresh);
  const ob = await outbox(repo);
  expect(ob.map((o) => o.entity_id)).toEqual([ids[0], fresh, ids[0]]);
});

test('백업은 남이 공유해 준 폴더와 그 항목을 빼고, 가져오기도 그런 행은 건너뛴다', async () => {
  const { repo, db } = await setup();
  const mine = await repo.addTodo('내 것', null, 'bottom');
  await db.run(`INSERT INTO folders (id, name, position, created_at, updated_at) VALUES ('theirs', '남의 폴더', 'V', 1, 1)`);
  await db.run(`INSERT INTO todos (id, folder_id, text, position, created_at, updated_at) VALUES ('t-theirs', 'theirs', '남의 것', 'V', 1, 1)`);
  await repo.sweepForeign(['theirs', 't-theirs'], [{ folder_id: 'theirs', role: 'view', owner: { id: 'o', email: 'o@example.com', name: '' } }]);
  const backup = await repo.exportAll();
  expect(backup.folders.map((f) => f.id)).toEqual([]);
  expect(backup.todos.map((t) => t.id)).toEqual([mine]);
  await repo.db.run(`DELETE FROM outbox`);
  const r = await repo.importAll({
    folders: [{ id: 'theirs', name: '남의 폴더', position: 'V', created_at: 1, updated_at: 9 }],
    todos: [{ id: 't-theirs', folder_id: 'theirs', text: '남의 것 고침', position: 'V', created_at: 1, updated_at: 9 }],
  });
  expect(r).toEqual({ added: 0, updated: 0 });
  expect(await outbox(repo)).toEqual([]);
});

test('완료 정리는 그 폴더만: 기본(null)은 폴더 없는 항목과 지워진 폴더를 가리키는 항목만', async () => {
  const { repo } = await setup();
  const work = await repo.createFolder('업무');
  const base = await repo.addTodo('기본 할 일', null, 'bottom');
  const w = await repo.addTodo('업무 할 일', work, 'bottom');
  for (const id of [base, w]) await repo.setDone(id, true);
  expect(await repo.clearDone(null)).toEqual([base]);
  expect(await repo.clearDone(work)).toEqual([w]);
});

test('메모는 줄마다 문단, 끝에 이어 쓰기, 나누기/합치기', async () => {
  const { repo } = await setup();
  await repo.appendParagraphs('회의 때 배포 일정 확인하기\n담당자도 함께 정해두기', null);
  await repo.appendParagraphs('세 번째', null);
  let ps = (await repo.snapshot()).paragraphs;
  expect(ps.map((p) => p.text)).toEqual(['회의 때 배포 일정 확인하기', '담당자도 함께 정해두기', '세 번째']);
  // 두 번째 문단 중간에서 줄바꿈
  await repo.splitParagraph(ps[1].id, '담당자도', [' 함께 정해두기']);
  ps = (await repo.snapshot()).paragraphs;
  expect(ps.map((p) => p.text)).toEqual(['회의 때 배포 일정 확인하기', '담당자도', ' 함께 정해두기', '세 번째']);
  await repo.mergeParagraphInto(ps[1].id, ps[2].id);
  ps = (await repo.snapshot()).paragraphs;
  expect(ps.map((p) => p.text)).toEqual(['회의 때 배포 일정 확인하기', '담당자도 함께 정해두기', '세 번째']);
});

test('휴지통: 삭제 → 복원, 영구 삭제는 행을 지우고 다른 기기에 알릴 op만 남긴다', async () => {
  const { repo } = await setup();
  const id = await repo.addTodo('지울 것', null, 'bottom');
  await repo.db.run(`DELETE FROM outbox`); // 이미 보냈다고 치자
  await repo.trash('todo', [id]);
  expect((await repo.snapshot()).todos[0].deleted_at).not.toBeNull();
  await repo.restore('todo', [id]);
  expect((await repo.snapshot()).todos[0].deleted_at).toBeNull();
  await repo.purge('todo', [id]);
  expect((await repo.snapshot()).todos).toHaveLength(0);
  expect(await repo.db.all(`SELECT * FROM todos`)).toHaveLength(0);
  const ob = await outbox(repo);
  expect(ob).toHaveLength(1);
  expect(ob[0].fields).toEqual({ purged: { old: false, new: true } });
});

test('아직 서버에 안 간 항목을 영구 삭제하면 만들기 op째 버린다', async () => {
  const { repo } = await setup();
  const id = await repo.addTodo('바로 지울 것', null, 'bottom');
  await repo.setTodoText(id, '고침');
  await repo.purge('todo', [id]);
  expect(await outbox(repo)).toHaveLength(0);
});

test('내보내기 → 다른 기기에서 가져오기(중복 없이, 더 최근 것 우선)', async () => {
  const a = await setup();
  const b = await setup();
  await a.repo.addTodo('A의 할 일', null, 'bottom');
  const data = JSON.parse(JSON.stringify(await a.repo.exportAll()));
  expect(await b.repo.importAll(data)).toEqual({ added: 1, updated: 0 });
  expect(await b.repo.importAll(data)).toEqual({ added: 0, updated: 0 });
  expect((await b.repo.snapshot()).todos.map((t) => t.text)).toEqual(['A의 할 일']);
});

test('v1 DB(todos.done 컬럼)를 열면 done_at으로 옮기고 컬럼을 없앤다', async () => {
  const db = await memoryDb();
  await db.exec(`CREATE TABLE todos (id TEXT PRIMARY KEY, folder_id TEXT, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
    done_at INTEGER, due_date TEXT, remind_at INTEGER, position TEXT NOT NULL, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, deleted_at INTEGER, purged INTEGER NOT NULL DEFAULT 0, owner_id TEXT, conflict_of TEXT,
    version INTEGER NOT NULL DEFAULT 0);
    INSERT INTO todos (id, text, done, position, created_at, updated_at) VALUES ('a', '끝낸 일', 1, 'V', 1, 7), ('b', '남은 일', 0, 'W', 1, 1);`);
  const repo = new Repo(db, randomUUID, () => 1000);
  await repo.init();
  const todos = (await repo.snapshot()).todos;
  expect(todos.map((t) => [t.text, t.done, t.done_at])).toEqual([
    ['끝낸 일', true, 7],
    ['남은 일', false, null],
  ]);
  const cols = await db.all<{ name: string }>(`PRAGMA table_info(todos)`);
  expect(cols.some((c) => c.name === 'done')).toBe(false);
});

test('폴더로 옮기는 변경은 그 사이 만든 폴더의 op보다 앞에 합치지 않는다(서버 폴더 FK)', async () => {
  const { repo } = await setup();
  const id = await repo.addTodo('할 일', null, 'bottom');
  await repo.db.run(`DELETE FROM outbox`);
  await repo.setTodoText(id, '고친 할 일');
  const folder = await repo.createFolder('새 폴더');
  await repo.setFolder('todo', id, folder);
  const ob = await outbox(repo);
  expect(ob.map((o) => [o.entity_id, Object.keys(o.fields).sort().join()])).toEqual([
    [id, 'text,updated_at'],
    [folder, 'created_at,deleted_at,name,position,updated_at'.split(',').filter((k) => k !== 'deleted_at').join()],
    [id, 'folder_id'],
  ]);
  // 뒤에 다른 op가 없으면(폴더가 이미 앞에 있으면) 그대로 합친다
  await repo.setTodoText(id, '또 고침');
  await repo.setFolder('todo', id, null);
  await repo.setFolder('todo', id, folder);
  expect((await outbox(repo)).length).toBe(3);
});

test('스냅샷: 안 바뀐 행은 같은 객체를 그대로 준다(카드가 다시 그려지지 않게)', async () => {
  const { repo } = await setup();
  const a = await repo.addTodo('A', null, 'bottom');
  await repo.addTodo('B', null, 'bottom');
  const s1 = await repo.snapshot();
  const s2 = await repo.snapshot();
  expect(s2.todos).toBe(s1.todos);
  await repo.setTodoText(a, 'A2');
  const s3 = await repo.snapshot();
  expect(s3.todos).not.toBe(s1.todos);
  expect(s3.todos[0]).not.toBe(s1.todos[0]);
  expect(s3.todos[1]).toBe(s1.todos[1]);
  expect(s3.todos.map((t) => t.text)).toEqual(['A2', 'B']);
});

test('긴 정렬 키는 순서 그대로 새로 매기고, 서버가 거절했던(200자 초과) 항목은 다시 만든다', async () => {
  const db = await memoryDb();
  const first = new Repo(db, randomUUID, () => 1);
  await first.init();
  // 예전 방식으로 맨 뒤에 계속 붙인 키(6개마다 한 글자씩 길어진다)를 흉내
  const legacy: string[] = [];
  let k = 'V';
  for (let i = 0; i < 260; i++) {
    legacy.push(k);
    k = i % 6 === 5 ? `${'z'.repeat(Math.floor(i / 6) * 5 + 5)}V` : `${k.slice(0, -1)}${'Vbhmprt'[(i % 6) + 1]}`;
  }
  legacy.sort();
  legacy.splice(0, legacy.length, ...legacy.slice(0, 3), 'z'.repeat(150) + 'V', 'z'.repeat(230) + 'V');
  for (const [i, pos] of legacy.entries()) {
    await db.run(`INSERT INTO todos (id, text, position, created_at, updated_at) VALUES (?, ?, ?, 1, 1)`, [`t${i}`, `할 일 ${i}`, pos]);
  }
  const before = (await db.all<{ id: string }>(`SELECT id FROM todos ORDER BY position, id`)).map((r) => r.id);
  const repo = new Repo(db, randomUUID, () => 2);
  await repo.init();
  const rows = await db.all<{ id: string; position: string }>(`SELECT id, position FROM todos ORDER BY position, id`);
  expect(rows.map((r) => r.id)).toEqual(before);
  expect(Math.max(...rows.map((r) => r.position.length))).toBeLessThanOrEqual(3);
  const ob = await outbox(repo);
  const longest = before[before.length - 1];
  expect(ob.find((o) => o.entity_id === longest)?.is_create).toBe(1);
  expect(ob.find((o) => o.entity_id === longest)?.fields.text).toEqual({ old: null, new: `할 일 ${before.length - 1}` });
  expect(ob.filter((o) => !o.is_create).every((o) => Object.keys(o.fields).join() === 'position')).toBe(true);
  // 다시 열어도 또 매기지 않는다
  await repo.init();
  expect((await outbox(repo)).length).toBe(ob.length);
  expect(keyBetween(rows[rows.length - 1].position, null).length).toBeLessThanOrEqual(3);
});

test('v3 DB를 열면 파생 열(owner_id)·version·purged를 없애고 공유 캐시를 주인 표로 나눈다', async () => {
  const db = await memoryDb();
  await db.exec(readFileSync(path.join(__dirname, 'schema_v3.sql'), 'utf8'));
  await db.exec(`
    INSERT INTO folders (id, name, position, created_at, updated_at, owner_id, version) VALUES
      ('mine', '내 폴더', 'V', 1, 1, 'me', 3), ('theirs', '공유받은 폴더', 'W', 1, 1, 'owner-1', 2);
    INSERT INTO todos (id, folder_id, text, position, created_at, updated_at, owner_id, version) VALUES
      ('t1', 'mine', '내 할 일', 'V', 1, 1, 'me', 1), ('t2', 'theirs', '남의 할 일', 'W', 1, 1, 'owner-1', 1);
    INSERT INTO todos (id, text, position, created_at, updated_at, purged) VALUES ('gone', '', 'X', 1, 1, 1);
    INSERT INTO paragraphs (id, text, position, created_at, updated_at, purged) VALUES ('p-gone', '', 'X', 1, 1, 1);
    INSERT INTO shared_folders (folder_id, role, owner_email) VALUES ('theirs', 'view', 'owner@example.com');
    INSERT INTO kv (key, value) VALUES ('schema_version', '3');`);
  const repo = new Repo(db, randomUUID, () => 1000);
  await repo.init();
  for (const t of ['todos', 'paragraphs', 'folders']) {
    const cols = (await db.all<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name);
    expect(cols.filter((c) => ['owner_id', 'version', 'purged'].includes(c))).toEqual([]);
  }
  const s = await repo.snapshot();
  expect(s.todos.map((t) => t.id)).toEqual(['t1', 't2']);
  expect(s.paragraphs).toHaveLength(0);
  expect(s.shared).toEqual([{ folder_id: 'theirs', role: 'view', owner: { id: 'owner-1', email: 'owner@example.com', name: '' }, home: true }]);
  // 공유 캐시가 남아 있어 로그아웃하면 남의 것만 지운다
  await repo.detachFromAccount();
  expect((await repo.snapshot()).todos.map((t) => t.id)).toEqual(['t1']);
  expect((await repo.snapshot()).folders.map((f) => f.id)).toEqual(['mine']);
});

test('다른 기기가 영구 삭제한 항목(deleted)을 지우고, 여기서 지운 항목은 되살리지 않는다', async () => {
  const { repo } = await setup();
  const a = await repo.addTodo('다른 기기에서 지울 것', null, 'bottom');
  const b = await repo.addTodo('여기서 지울 것', null, 'bottom');
  await repo.db.run(`DELETE FROM outbox`);
  await repo.purge('todo', [b]);
  const row = (id: string, text: string) => ({ id, folder_id: null, text, position: 'a0', created_at: 1, updated_at: 1 });
  await repo.applyRemote({ folders: [], todos: [row(b, '서버에 아직 남은 b')], paragraphs: [], deleted: [{ id: a, entity: 'todo' }] }, new Set(), new Map());
  expect((await repo.snapshot()).todos).toHaveLength(0);
});

test('로그아웃은 공유가 끊긴 뒤 못 보낸 변경 때문에 남겨 둔 남의 항목(past_shared)도 지운다', async () => {
  const { repo, db } = await setup();
  await db.run(`INSERT INTO folders (id, name, position, created_at, updated_at) VALUES ('gone', '옛 공유', 'V', 1, 1)`);
  await db.run(`INSERT INTO todos (id, folder_id, text, position, created_at, updated_at) VALUES ('ghost', 'gone', '남의 것', 'V', 1, 1)`);
  await repo.write(() => repo.setKv('past_shared', ['gone']));
  await repo.detachFromAccount();
  const s = await repo.snapshot();
  expect(s.todos.map((t) => t.id)).toEqual([]);
  expect(s.folders.map((f) => f.id)).toEqual([]);
  // 비어 있으면 쓰기 트랜잭션 없이 바로 빈 목록
  expect(await repo.takeOutbox(10)).toEqual([]);
});

test('서버가 같은 값을 다시 보내면(내가 보낸 변경의 메아리, 처음부터 다시 받기) 행을 다시 쓰지 않고 화면도 다시 읽지 않는다', async () => {
  const { repo } = await setup();
  const row = { id: 'r1', folder_id: null, text: '받은 할 일', position: 'a0', created_at: 1, updated_at: 5 };
  await repo.applyRemote({ folders: [], todos: [row], paragraphs: [] }, new Set(), new Map());
  const seen: string[][] = [];
  repo.subscribe((_source, tables) => seen.push([...tables]));
  await repo.applyRemote({ folders: [], todos: [row], paragraphs: [] }, new Set(), new Map());
  expect(seen).toEqual([]);
  // 바뀐 칸만 쓴다
  await repo.applyRemote({ folders: [], todos: [{ ...row, text: '고친 글', updated_at: 6 }], paragraphs: [] }, new Set(), new Map());
  expect(seen).toEqual([['todos']]);
  expect((await repo.snapshot()).todos.map((t) => t.text)).toEqual(['고친 글']);
});

test('공유가 끊긴 폴더의 항목은 지우되 방금 만들어 아직 못 보낸 항목은 남긴다', async () => {
  const { repo, db } = await setup();
  await db.run(`INSERT INTO folders (id, name, position, created_at, updated_at) VALUES ('f', '공유', 'V', 1, 1)`);
  await db.run(`INSERT INTO todos (id, folder_id, text, position, created_at, updated_at) VALUES ('old', 'f', '받은 것', 'V', 1, 1)`);
  await repo.sweepForeign(['f', 'old'], [{ folder_id: 'f', role: 'edit', owner: { id: 'o', email: 'o@example.com', name: '' } }]);
  const fresh = await repo.addTodo('방금 쓴 것', 'f', 'bottom');
  await repo.sweepForeign([], []);
  const s = await repo.snapshot();
  expect(s.todos.map((t) => t.id)).toEqual([fresh]);
  expect(s.folders).toHaveLength(0);
  expect(s.shared).toEqual([]);
});

test('한 번 보낸(응답을 못 받은) op에는 새 변경을 합치지 않는다', async () => {
  const { repo } = await setup();
  const id = await repo.addTodo('처음', null, 'bottom');
  await repo.takeOutbox(10);
  await repo.releaseOutbox(); // 보냈지만 응답을 잃음(서버는 이미 적용했을 수 있다)
  await repo.setTodoText(id, '그 뒤 고침');
  const ob = await outbox(repo);
  expect(ob).toHaveLength(2);
  expect(ob[1].fields.text).toEqual({ old: '처음', new: '그 뒤 고침' });
});

test('보내는 도중 앱이 죽었다 다시 켜도, 그 op에는 새 변경을 합치지 않는다', async () => {
  const { repo, db } = await setup();
  const id = await repo.addTodo('처음', null, 'bottom');
  await repo.takeOutbox(10); // 보내는 중(inflight)에 앱이 죽음
  const reopened = new Repo(db, randomUUID, () => 5000);
  await reopened.init();
  await reopened.setTodoText(id, '다시 켠 뒤 고침');
  const ob = await outbox(reopened);
  expect(ob).toHaveLength(2);
  expect(ob[1].fields.text).toEqual({ old: '처음', new: '다시 켠 뒤 고침' });
});

test('로그아웃 때 보내던 op도 다시 보낼 op로 남고, 새 변경은 거기 합치지 않는다', async () => {
  const { repo } = await setup();
  const id = await repo.addTodo('처음', null, 'bottom');
  await repo.takeOutbox(10);
  await repo.detachFromAccount();
  await repo.setTodoText(id, '로그아웃 뒤 고침');
  const ob = await outbox(repo);
  expect(ob).toHaveLength(2);
  expect(ob[1].fields.text).toEqual({ old: '처음', new: '로그아웃 뒤 고침' });
});

test('글에 섞인 NUL 문자는 저장 전에 뺀다(서버 DB가 받지 않는다)', async () => {
  const { repo } = await setup();
  const id = await repo.addTodo('앞\u0000뒤', null, 'bottom');
  await repo.setTodoText(id, '고친\u0000글');
  expect((await repo.snapshot()).todos[0].text).toBe('고친글');
  expect(JSON.stringify(await outbox(repo))).not.toContain('\\u0000');
});

test('로그아웃해도 못 보낸 변경(영구 삭제 포함)은 남고, 다른 계정이면 전부 다시 올린다', async () => {
  const { repo } = await setup();
  const keep = await repo.addTodo('남길 것', null, 'bottom');
  const gone = await repo.addTodo('지울 것', null, 'bottom');
  await repo.db.run(`DELETE FROM outbox`);
  await repo.purge('todo', [gone]);
  await repo.setTodoText(keep, '로그아웃 전 고침');
  await repo.detachFromAccount();
  const ob = await outbox(repo);
  expect(ob.find((o) => o.entity_id === gone)?.fields).toEqual({ purged: { old: false, new: true } });
  // 고친 것은 이전값과 함께 그대로(같은 계정으로 다시 들어오면 정상 비교)
  expect(ob.find((o) => o.entity_id === keep)?.fields.text).toEqual({ old: '남길 것', new: '로그아웃 전 고침' });
  // 다른 계정으로 들어가면 전부 '만들기'로 다시
  await repo.reuploadAll();
  expect((await outbox(repo)).map((o) => [o.entity_id, o.is_create])).toEqual([[keep, 1]]);
});

test('공유가 끊긴 폴더에 못 보낸 변경이 남은 항목은, 다음 정리 때 다시 보고 지운다', async () => {
  const { repo, db } = await setup();
  await db.run(`INSERT INTO folders (id, name, position, created_at, updated_at) VALUES ('f', '공유', 'V', 1, 1)`);
  await db.run(`INSERT INTO todos (id, folder_id, text, position, created_at, updated_at) VALUES ('t', 'f', '받은 것', 'V', 1, 1)`);
  await repo.sweepForeign(['f', 't'], [{ folder_id: 'f', role: 'edit', owner: { id: 'o', email: '', name: '' } }]);
  await repo.setTodoText('t', '고침'); // 아직 못 보냄
  await repo.sweepForeign([], []); // 공유 끊김: 못 보낸 항목은 남긴다
  expect((await repo.snapshot()).todos.map((x) => x.id)).toEqual(['t']);
  await db.run(`DELETE FROM outbox`); // 보냈더니 거절됨(ack)
  await repo.sweepForeign([], []);
  expect((await repo.snapshot()).todos).toHaveLength(0);
});

test('v4 DB(루틴 기록 열 전)를 열면 열만 더하고 기존 행·보낼 변경은 그대로 남는다(쓰지 않는 인덱스는 지운다)', async () => {
  const db = await memoryDb();
  // v4 = 지금 스키마에서 done_log 열을 빼고, 예전 due_date 인덱스가 있던 모양
  const v4 = SCHEMA.replace(/\n\s*done_log TEXT,[^\n]*/, '').replace('DROP INDEX IF EXISTS todos_due;', 'CREATE INDEX IF NOT EXISTS todos_due ON todos (due_date);');
  expect(v4).not.toContain('done_log');
  await db.exec(v4);
  await db.exec(`
    INSERT INTO folders (id, name, position, created_at, updated_at) VALUES ('f', '업무', 'V', 1, 2);
    INSERT INTO todos (id, folder_id, text, position, created_at, updated_at, done_at, due_date, remind_at, repeat_freq, repeat_days)
      VALUES ('r', 'f', '영양제 먹기', 'V', 1, 2, 3, '2026-10-19', 4, 'weekly', 21), ('n', NULL, '장보기', 'W', 1, 2, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO paragraphs (id, folder_id, text, position, created_at, updated_at) VALUES ('p', 'f', '메모', 'V', 1, 2);
    INSERT INTO outbox (op_id, entity, entity_id, is_create, fields, created_at) VALUES ('op1', 'todo', 'n', 0, '{"text":{"old":"장","new":"장보기"}}', 9);
    INSERT INTO kv (key, value) VALUES ('schema_version', '4'), ('sync_cursor', '77');`);
  const before = await db.all(`SELECT id, folder_id, text, done_at, due_date, remind_at, repeat_freq, repeat_days, position, created_at, updated_at FROM todos ORDER BY id`);
  const repo = new Repo(db, randomUUID, () => 1000);
  await repo.init();
  const cols = (await db.all<{ name: string }>(`PRAGMA table_info(todos)`)).map((c) => c.name);
  expect(cols).toContain('done_log');
  expect(await db.all(`SELECT id, folder_id, text, done_at, due_date, remind_at, repeat_freq, repeat_days, position, created_at, updated_at FROM todos ORDER BY id`)).toEqual(before);
  expect((await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'todos_due'`)).length).toBe(0);
  // 보내지 못한 변경은 그대로(오프라인에서 고친 것이 사라지지 않는다), 새 열을 채우려 한 번 처음부터 다시 받는다
  expect((await db.all<{ op_id: string }>(`SELECT op_id FROM outbox`)).map((r) => r.op_id)).toEqual(['op1']);
  expect(await repo.getKv('sync_cursor', -1)).toBe(0);
  expect(await repo.getKv('schema_version', 0)).toBe(5);
  const s = await repo.snapshot();
  expect(s.paragraphs.map((p) => p.text)).toEqual(['메모']);
  expect(s.folders.map((f) => f.name)).toEqual(['업무']);
});

test('내 폴더에 복사: 새 id의 독립된 항목, 미완료·알림 없이, 날짜·반복은 고른 대로, 메모는 덮어쓰지 않고 덧붙인다', async () => {
  const { repo, db } = await setup();
  await db.run(`INSERT INTO folders (id, name, position, created_at, updated_at) VALUES ('theirs', '여행', 'V', 1, 1)`);
  await db.run(
    `INSERT INTO todos (id, folder_id, text, position, done_at, due_date, repeat_freq, remind_at, created_at, updated_at) VALUES ('t1', 'theirs', '숙소 예약', 'V', 5, '2026-11-01', 'weekly', 99, 1, 1)`,
  );
  await repo.sweepForeign(['theirs', 't1'], [{ folder_id: 'theirs', role: 'view', owner: { id: 'o', email: 'o@example.com', name: '' } }]);
  const mine = await repo.createFolder('내 여행');
  await repo.appendParagraphs('원래 메모', mine);
  const src = (await repo.snapshot()).todos.find((x) => x.id === 't1')!;

  await repo.copyItems({ todos: [src], paragraphs: ['같이 갈 곳'], target: mine, keepDates: true, header: '— 여행에서 복사 —' });
  await repo.copyItems({ todos: [src], paragraphs: [], target: null, keepDates: false });
  const s = await repo.snapshot();
  const copies = s.todos.filter((x) => x.text === '숙소 예약' && x.id !== 't1');
  expect(copies).toHaveLength(2);
  const kept = copies.find((x) => x.folder_id === mine)!;
  const bare = copies.find((x) => x.folder_id === null)!;
  expect([kept.done, kept.remind_at, kept.due_date, kept.repeat_freq]).toEqual([false, null, '2026-11-01', 'weekly']);
  expect([bare.done, bare.remind_at, bare.due_date, bare.repeat_freq]).toEqual([false, null, null, null]);
  expect(s.paragraphs.filter((p) => p.folder_id === mine).map((p) => p.text)).toEqual(['원래 메모', '— 여행에서 복사 —', '같이 갈 곳']);
  // 원본은 그대로(공유 폴더의 항목은 바뀌지 않고, 복사본은 내 것이라 보낼 큐에 오른다)
  expect(s.todos.find((x) => x.id === 't1')!.done).toBe(true);
  const sent = (await outbox(repo)).map((o) => o.entity_id);
  expect(sent).toContain(kept.id);
  expect(sent).not.toContain('t1');
});

test('공유 폴더의 홈 표시는 참여자 각자의 설정: 동기화로 받고, 서버가 받아들이면 이 기기에도 바로', async () => {
  const { repo, db } = await setup();
  await db.run(`INSERT INTO folders (id, name, position, created_at, updated_at) VALUES ('f', '장보기', 'V', 1, 1)`);
  const owner = { id: 'o', email: 'o@example.com', name: '' };
  await repo.sweepForeign(['f'], [{ folder_id: 'f', role: 'edit', owner, home: false }]);
  expect((await repo.snapshot()).shared.map((x) => [x.folder_id, x.home])).toEqual([['f', false]]);
  await repo.setSharedHome('f', true);
  expect((await repo.snapshot()).shared[0].home).toBe(true);
  // 예전 서버(home을 보내지 않음)는 늘 보이게
  await repo.sweepForeign(['f'], [{ folder_id: 'f', role: 'edit', owner }]);
  expect((await repo.snapshot()).shared[0].home).toBe(true);
  // 홈 표시는 내 설정이라 보낼 큐에 오르지 않는다
  expect(await outbox(repo)).toEqual([]);
});
