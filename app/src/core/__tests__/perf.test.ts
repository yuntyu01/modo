import { randomUUID } from 'node:crypto';

import { Repo } from '../repo';
import { SyncEngine } from '../sync';
import { memoryDb } from './sqljsDb';

// 속도 측정(기본은 건너뜀). PERF_SERVER=http://127.0.0.1:8080 npx jest perf
// 개인 사용 규모의 큰 쪽(폴더 10, 할 일 2000, 메모 문단 2000)으로 로컬 쓰기·읽기·첫 동기화·빈 동기화를 잰다.
const SERVER = process.env.PERF_SERVER;
const maybe = SERVER ? describe : describe.skip;

async function device(counter: { requests: number }) {
  const db = await memoryDb();
  const repo = new Repo(db, randomUUID);
  await repo.init();
  const countingFetch = (async (url: string, init?: RequestInit) => {
    counter.requests++;
    return fetch(url, init);
  }) as typeof fetch;
  return { repo, sync: new SyncEngine(repo, countingFetch, 'perf') };
}

async function time<T>(fn: () => Promise<T>) {
  const t = performance.now();
  const out = await fn();
  return [out, performance.now() - t] as const;
}

maybe('속도', () => {
  test('로컬·동기화', async () => {
    const report: Record<string, string> = {};
    const net = { requests: 0 };
    const a = await device(net);
    const folders: string[] = [];
    for (let i = 0; i < 10; i++) folders.push(await a.repo.createFolder(`폴더 ${i}`));
    const [, writeMs] = await time(async () => {
      for (let i = 0; i < 2000; i++) await a.repo.addTodo(`할 일 ${i} 내용을 조금 길게 적어 둔다`, folders[i % 10], 'bottom');
      for (let i = 0; i < 200; i++) await a.repo.appendParagraphs(Array.from({ length: 10 }, (_, j) => `메모 ${i}-${j} 문단`).join('\n'), folders[i % 10]);
    });
    report['로컬 쓰기 2200회(할 일 2000 + 메모 200번 이어 쓰기)'] = `${writeMs.toFixed(0)} ms`;

    const [snap, snapMs] = await time(() => a.repo.snapshot());
    for (let i = 0; i < 4; i++) await a.repo.snapshot();
    const [, snap5] = await time(async () => {
      for (let i = 0; i < 5; i++) await a.repo.snapshot();
    });
    report[`snapshot(할 일 ${snap.todos.length}, 문단 ${snap.paragraphs.length})`] = `첫 ${snapMs.toFixed(1)} ms, 평균 ${(snap5 / 5).toFixed(1)} ms`;

    const id = snap.todos[1000].id;
    const [, editMs] = await time(async () => {
      for (let i = 0; i < 50; i++) {
        await a.repo.setTodoText(id, `고친 글 ${i}`);
        await a.repo.snapshot();
      }
    });
    report['글 고치기 + 다시 읽기(자동 저장 1회분, 전체 다시 읽기)'] = `${(editMs / 50).toFixed(1)} ms`;
    // 화면은 바뀐 표만 다시 읽는다(repo.snapshot(tables), AppContext)
    const pid = snap.paragraphs[1000].id;
    const [, memoMs] = await time(async () => {
      for (let i = 0; i < 50; i++) {
        await a.repo.setParagraphText(pid, `메모 고침 ${i}`);
        await a.repo.snapshot(new Set(['paragraphs', 'outbox']));
      }
    });
    report['메모 고치기 + 바뀐 표만 다시 읽기'] = `${(memoMs / 50).toFixed(1)} ms`;
    const [, kvMs] = await time(async () => {
      for (let i = 0; i < 50; i++) {
        await a.repo.write(() => a.repo.setKv('sync_cursor', i));
        await a.repo.snapshot(new Set(['kv']));
      }
    });
    report['설정(kv)만 바뀐 쓰기 + 다시 읽기(건너뜀)'] = `${(kvMs / 50).toFixed(1)} ms`;

    const email = `p${randomUUID().slice(0, 8)}@example.com`;
    net.requests = 0;
    const [, upMs] = await time(() => a.sync.login(SERVER!, email, 'password123', true));
    report['첫 로그인 업로드(op 4210개)'] = `${upMs.toFixed(0)} ms, 요청 ${net.requests}회`;

    const net2 = { requests: 0 };
    const b = await device(net2);
    const [, downMs] = await time(() => b.sync.login(SERVER!, email, 'password123', false));
    const bs = await b.repo.snapshot();
    report[`다른 기기 첫 받기(할 일 ${bs.todos.length}, 문단 ${bs.paragraphs.length})`] = `${downMs.toFixed(0)} ms, 요청 ${net2.requests}회`;

    net2.requests = 0;
    const [, idleMs] = await time(async () => {
      for (let i = 0; i < 20; i++) await b.sync.syncNow();
    });
    report['변경 없는 동기화(30초마다 도는 것)'] = `${(idleMs / 20).toFixed(1)} ms, 1회당 요청 ${net2.requests / 20}회`;

    await a.repo.setTodoText(id, '한 기기에서 고침');
    const [, oneMs] = await time(async () => {
      await a.sync.syncNow();
      await b.sync.syncNow();
    });
    report['한 건 고친 뒤 올리고 다른 기기가 받기'] = `${oneMs.toFixed(0)} ms`;

    console.log(Object.entries(report).map(([k, v]) => `${k}: ${v}`).join('\n'));
  }, 600_000);
});
