import { randomUUID } from 'node:crypto';

import { Repo } from '../repo';
import { SyncEngine } from '../sync';
import { memoryDb } from './sqljsDb';

// 실제 Go 서버(+Postgres)를 상대로 두 기기를 흉내 낸다. SYNC_TEST_SERVER가 없으면 건너뜀.
const SERVER = process.env.SYNC_TEST_SERVER;
const maybe = SERVER ? describe : describe.skip;

type Device = { repo: Repo; sync: SyncEngine; net: { offline: boolean; dropNextResponse: boolean; pushes: number } };

async function device(name: string): Promise<Device> {
  const db = await memoryDb();
  const repo = new Repo(db, randomUUID);
  await repo.init();
  const net = { offline: false, dropNextResponse: false, pushes: 0 };
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    if (net.offline) throw new TypeError('network down');
    const res = await fetch(url, init);
    if (url.includes('/sync/push')) {
      net.pushes++;
      if (net.dropNextResponse) {
        // 서버는 처리했지만 응답이 유실된 상황
        net.dropNextResponse = false;
        throw new TypeError('connection reset');
      }
    }
    return res;
  }) as typeof fetch;
  return { repo, sync: new SyncEngine(repo, fakeFetch, name), net };
}

const email = () => `u${randomUUID().slice(0, 8)}@example.com`;
const texts = async (d: Device) => (await d.repo.snapshot()).todos.map((t) => t.text).sort();
const memo = async (d: Device) => (await d.repo.snapshot()).paragraphs.map((p) => p.text);

maybe('기기 간 동기화 (실서버)', () => {
  test('로그인 전 로컬 기록이 로그인 후 그대로 올라가고 다른 기기에 내려온다', async () => {
    const phone = await device('phone');
    const pc = await device('pc');
    const work = await phone.repo.createFolder('업무');
    await phone.repo.addTodo('회의 자료 정리', work, 'bottom');
    await phone.repo.appendParagraphs('회의 때 배포 일정 확인하기\n담당자도 함께 정해두기', work);
    const e = email();
    await phone.sync.login(SERVER!, e, 'password123', true);
    expect(phone.sync.status.state).toBe('idle');
    await pc.sync.login(SERVER!, e, 'password123', false);
    expect(await texts(pc)).toEqual(['회의 자료 정리']);
    expect(await memo(pc)).toEqual(['회의 때 배포 일정 확인하기', '담당자도 함께 정해두기']);
    const s = await pc.repo.snapshot();
    expect(s.todos[0].folder_id).toBe(s.folders[0].id);
  });

  test('반복 설정과 반복 완료(다음 예정일로 넘김)가 다른 기기에 그대로 내려온다', async () => {
    const phone = await device('phone');
    const pc = await device('pc');
    const e = email();
    await phone.sync.login(SERVER!, e, 'password123', true);
    await pc.sync.login(SERVER!, e, 'password123', false);
    const id = await phone.repo.addTodo('영양제 먹기', null, 'bottom');
    const today = new Date();
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await phone.repo.setRepeat(id, { freq: 'daily', days: null }, fmt(today));
    await phone.sync.syncNow();
    await pc.sync.syncNow();
    let t = (await pc.repo.snapshot()).todos.find((x) => x.id === id)!;
    expect([t.repeat_freq, t.repeat_days, t.due_date]).toEqual(['daily', null, fmt(today)]);
    // PC에서 체크 → 휴대폰에 내일 예정으로
    await pc.repo.complete(id);
    await pc.sync.syncNow();
    await phone.sync.syncNow();
    t = (await phone.repo.snapshot()).todos.find((x) => x.id === id)!;
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    // 이번 회차를 끝내 두면 다음 예정일(내일)까지 체크된 채로 남고, 한 날 기록(오늘)도 함께 내려온다
    expect([t.done, t.due_date]).toEqual([true, fmt(tomorrow)]);
    expect(t.done_log).toContain(fmt(today));
    // 매주 월·금으로 바꾸면 요일 비트도 함께
    await phone.repo.setRepeat(id, { freq: 'weekly', days: 1 | 16 }, fmt(tomorrow));
    await phone.sync.syncNow();
    await pc.sync.syncNow();
    t = (await pc.repo.snapshot()).todos.find((x) => x.id === id)!;
    expect([t.repeat_freq, t.repeat_days]).toEqual(['weekly', 17]);
    phone.sync.stop();
    pc.sync.stop();
  });

  test('오프라인 변경은 큐에 남았다가 재접속 때 한 번만 반영된다(응답 유실 재시도 포함)', async () => {
    const phone = await device('phone');
    const pc = await device('pc');
    const e = email();
    await phone.sync.login(SERVER!, e, 'password123', true);
    await pc.sync.login(SERVER!, e, 'password123', false);

    phone.net.offline = true;
    await phone.repo.addTodo('지하철에서 추가', null, 'bottom');
    await phone.sync.syncNow();
    expect(phone.sync.status.state).toBe('offline');
    expect(await phone.repo.outboxCount()).toBe(1);
    phone.sync.stop(); // 백오프 타이머 정리

    phone.net.offline = false;
    phone.net.dropNextResponse = true;
    await phone.sync.syncNow(); // 서버는 받았지만 응답 유실
    expect(await phone.repo.outboxCount()).toBe(1);
    phone.sync.stop();
    await phone.sync.syncNow(); // 같은 op_id로 재전송
    expect(await phone.repo.outboxCount()).toBe(0);

    await pc.sync.syncNow();
    expect(await texts(pc)).toEqual(['지하철에서 추가']); // 중복 없음
  });

  test('두 기기에서 같은 메모 문단을 고치면 둘 다 보존된다', async () => {
    const phone = await device('phone');
    const pc = await device('pc');
    const e = email();
    await phone.sync.login(SERVER!, e, 'password123', true);
    await phone.repo.appendParagraphs('원래 문단', null);
    await phone.sync.syncNow();
    await pc.sync.login(SERVER!, e, 'password123', false);

    const pid = (await pc.repo.snapshot()).paragraphs[0].id;
    await phone.repo.setParagraphText(pid, '폰에서 고침');
    await pc.repo.setParagraphText(pid, 'PC에서 고침');
    await phone.sync.syncNow();
    await pc.sync.syncNow();
    await phone.sync.syncNow();

    const expected = ['폰에서 고침', 'PC에서 고침'];
    expect(await memo(phone)).toEqual(expected);
    expect(await memo(pc)).toEqual(expected);
    const copy = (await pc.repo.snapshot()).paragraphs[1];
    expect(copy.conflict_of).toBe(pid);
  });

  test('편집 중인 항목은 원격 변경이 바로 덮어쓰지 않고, 편집이 끝나면 반영된다', async () => {
    const phone = await device('phone');
    const pc = await device('pc');
    const e = email();
    await phone.sync.login(SERVER!, e, 'password123', true);
    const id = await phone.repo.addTodo('처음', null, 'bottom');
    await phone.sync.syncNow();
    await pc.sync.login(SERVER!, e, 'password123', false);

    phone.sync.beginEdit(id); // 폰에서 커서만 올려 둔 상태
    await pc.repo.setTodoText(id, 'PC가 고침');
    await pc.sync.syncNow();
    await phone.sync.syncNow();
    expect(await texts(phone)).toEqual(['처음']);
    await phone.sync.endEdit(id);
    expect(await texts(phone)).toEqual(['PC가 고침']);
  });

  test('삭제·완료·폴더 이동이 동기화된다', async () => {
    const phone = await device('phone');
    const pc = await device('pc');
    const e = email();
    await phone.sync.login(SERVER!, e, 'password123', true);
    const a = await phone.repo.addTodo('A', null, 'bottom');
    const b = await phone.repo.addTodo('B', null, 'bottom');
    await phone.sync.syncNow();
    await pc.sync.login(SERVER!, e, 'password123', false);

    const f = await pc.repo.createFolder('개인');
    await pc.repo.trash('todo', [a]);
    await pc.repo.setDone(b, true);
    await pc.repo.setFolder('todo', b, f);
    await pc.sync.syncNow();
    await phone.sync.syncNow();
    const s = await phone.repo.snapshot();
    expect(s.todos.find((t) => t.id === a)!.deleted_at).not.toBeNull();
    const tb = s.todos.find((t) => t.id === b)!;
    expect(tb.done).toBe(true);
    expect(tb.folder_id).toBe(f);
  });

  test('영구 삭제가 다른 기기에서도 지워지고, 오래 꺼져 있던 기기가 다시 올려도 살아나지 않는다', async () => {
    const phone = await device('phone');
    const pc = await device('pc');
    const e = email();
    await phone.sync.login(SERVER!, e, 'password123', true);
    const id = await phone.repo.addTodo('지울 할 일', null, 'bottom');
    const pid = (await phone.repo.appendParagraphs('지울 문단', null))[0];
    await phone.sync.syncNow();
    await pc.sync.login(SERVER!, e, 'password123', false);
    expect(await texts(pc)).toEqual(['지울 할 일']);
    // PC는 꺼진 채 그 할 일을 고쳐 둔다
    pc.net.offline = true;
    await pc.repo.setTodoText(id, '오프라인에서 고침');
    await phone.repo.trash('todo', [id]);
    await phone.repo.purge('todo', [id]);
    await phone.repo.purge('paragraph', [pid]);
    await phone.sync.syncNow();
    pc.net.offline = false;
    await pc.sync.syncNow();
    expect(await texts(pc)).toEqual([]);
    expect(await memo(pc)).toEqual([]);
    expect(await pc.repo.outboxCount()).toBe(0);
    // 로그아웃 후 다시 로그인(전부 다시 올림)해도 지운 것은 서버에 없다
    await pc.sync.logout();
    await pc.sync.login(SERVER!, e, 'password123', false);
    await phone.sync.syncNow();
    expect(await texts(phone)).toEqual([]);
  });

  test('로그아웃 후 다시 로그인해도 그 사이 다른 기기가 고친 것을 덮어쓰지 않는다', async () => {
    const phone = await device('phone');
    const pc = await device('pc');
    const e = email();
    await phone.sync.login(SERVER!, e, 'password123', true);
    const id = await phone.repo.addTodo('처음 글', null, 'bottom');
    await phone.sync.syncNow();
    await pc.sync.login(SERVER!, e, 'password123', false);
    await phone.sync.logout();
    await pc.repo.setTodoText(id, 'PC가 고친 글');
    await pc.repo.setDone(id, true);
    await pc.sync.syncNow();
    await phone.sync.login(SERVER!, e, 'password123', false);
    let t = (await phone.repo.snapshot()).todos;
    expect(t.map((x) => [x.text, x.done])).toEqual([['PC가 고친 글', true]]);
    // 로그아웃한 동안 같은 글을 고쳤으면 둘 다 남는다(덮어쓰지 않음)
    await phone.sync.logout();
    await phone.repo.setTodoText(id, '휴대폰이 로그아웃 중 고친 글');
    await pc.repo.setTodoText(id, 'PC가 또 고친 글');
    await pc.sync.syncNow();
    await phone.sync.login(SERVER!, e, 'password123', false);
    await pc.sync.syncNow();
    t = (await pc.repo.snapshot()).todos;
    expect(t.map((x) => x.text).sort()).toEqual(['PC가 또 고친 글', '휴대폰이 로그아웃 중 고친 글']);
  });

  test('폴더 공유: 공유한 폴더만 보이고, 해제하면 받은 쪽에서 지워진다', async () => {
    const owner = await device('owner');
    const guest = await device('guest');
    const oe = email();
    const ge = email();
    await owner.sync.login(SERVER!, oe, 'password123', true);
    await guest.sync.login(SERVER!, ge, 'password123', true);
    const work = await owner.repo.createFolder('업무');
    const priv = await owner.repo.createFolder('개인');
    await owner.repo.addTodo('업무 할 일', work, 'bottom');
    await owner.repo.addTodo('비밀', priv, 'bottom');
    await owner.repo.appendParagraphs('업무 메모', work);
    await owner.repo.appendParagraphs('비밀 메모', null);
    await guest.repo.addTodo('게스트 자기 것', null, 'bottom');
    await owner.sync.syncNow();
    await guest.sync.syncNow();

    const share = await owner.sync.shareApi<{ user_id: string }>(`/api/folders/${work}/members`, {
      method: 'POST',
      body: JSON.stringify({ email: ge, role: 'view' }),
    });
    await guest.sync.syncNow();
    expect(await texts(guest)).toEqual(['게스트 자기 것', '업무 할 일']);
    expect(await memo(guest)).toEqual(['업무 메모']);
    const ownerId = (await owner.sync.account())!.id;
    expect((await guest.repo.snapshot()).shared).toEqual([{ folder_id: work, role: 'view', owner: { id: ownerId, email: oe, name: '' } }]);

    // 보기 권한으로 고치면 서버가 거절하고 원래 값으로 돌아온다
    const wt = (await guest.repo.snapshot()).todos.find((t) => t.text === '업무 할 일')!;
    await guest.repo.setTodoText(wt.id, '몰래 고침');
    await guest.sync.syncNow();
    await guest.sync.syncNow();
    expect(await texts(guest)).toEqual(['게스트 자기 것', '업무 할 일']);
    expect(guest.sync.status.rejected).toBe(1);

    await owner.sync.shareApi(`/api/folders/${work}/members/${share.user_id}`, { method: 'DELETE' });
    await guest.sync.syncNow();
    expect(await texts(guest)).toEqual(['게스트 자기 것']);
    expect(await memo(guest)).toEqual([]);
  });
});
