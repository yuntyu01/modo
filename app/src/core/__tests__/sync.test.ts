import { randomUUID } from 'node:crypto';

import { Repo } from '../repo';
import { AUTH_REDIRECT, AuthCancelled, SyncEngine } from '../sync';
import { memoryDb } from './sqljsDb';

// 카카오 로그인 흐름(서버 없이): 시작 주소 → 브라우저가 앱 주소로 돌아옴 → 코드 교환
async function engine(handler: (url: string, init?: RequestInit) => unknown) {
  const db = await memoryDb();
  const repo = new Repo(db, randomUUID);
  await repo.init();
  const calls: { url: string; body?: unknown }[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const out = handler(url, init);
    return new Response(JSON.stringify(out ?? {}), { status: 200 });
  }) as typeof fetch;
  return { repo, sync: new SyncEngine(repo, fakeFetch, 'test'), calls };
}

const pkce = { verifier: 'v'.repeat(43), challenge: 'c'.repeat(43) };
const user = { token: 'tok', user: { id: 'u1', email: '', name: '카카오 사용자' } };
const serverReply = (url: string) => {
  if (url.endsWith('/api/auth/exchange')) return user;
  if (url.includes('/api/sync/pull')) return { folders: [], todos: [], paragraphs: [], deleted: [], cursor: 0, more: false, shared: [], foreign_ids: [] };
  return { results: [] };
};

test('store review uses the existing credential endpoint and cannot create an account', async () => {
  const { sync, calls } = await engine((url) => url.endsWith('/api/auth/review') ? user : serverReply(url));
  const acc = await sync.login('http://srv', 'review@example.test', 'test-password', false, true);
  expect(acc.id).toBe('u1');
  expect(calls[0]).toEqual({ url: 'http://srv/api/auth/review', body: { email: 'review@example.test', password: 'test-password', device: 'test' } });
  await expect(sync.login('http://srv', 'review@example.test', 'test-password', true, true)).rejects.toThrow('cannot be registered');
});

test.each(['kakao', 'google'] as const)('%s: 시작 주소에 앱 주소·state·challenge를 싣고, 돌아온 code를 verifier와 함께 바꾼다', async (provider) => {
  const { sync, calls } = await engine(serverReply);
  let opened = '';
  const acc = await sync.loginExternal('http://srv/', provider, async (url, redirect) => {
    opened = url;
    expect(redirect).toBe(AUTH_REDIRECT);
    return `${AUTH_REDIRECT}?code=abc%2B1&state=st-1`;
  }, pkce, 'st-1');
  expect(opened.startsWith(`http://srv/api/auth/${provider}/start?`)).toBe(true);
  expect(opened).toContain(`redirect_uri=${encodeURIComponent(AUTH_REDIRECT)}`);
  expect(opened).toContain(`code_challenge=${pkce.challenge}`);
  expect(opened).toContain('state=st-1');
  const ex = calls.find((c) => c.url.endsWith('/api/auth/exchange'))!;
  expect(ex.body).toEqual({ code: 'abc+1', code_verifier: pkce.verifier, device: 'test' });
  expect(acc).toMatchObject({ id: 'u1', email: '', name: '카카오 사용자', token: 'tok' });
  expect((await sync.account())?.name).toBe('카카오 사용자');
});

test('카카오: 창을 닫거나 취소하면 AuthCancelled, state가 다르면 거절', async () => {
  const { sync, calls } = await engine(serverReply);
  await expect(sync.loginExternal('http://srv', 'kakao', async () => null, pkce, 's')).rejects.toBeInstanceOf(AuthCancelled);
  await expect(
    sync.loginExternal('http://srv', 'kakao', async () => `${AUTH_REDIRECT}?error=cancelled&state=s`, pkce, 's'),
  ).rejects.toBeInstanceOf(AuthCancelled);
  await expect(
    sync.loginExternal('http://srv', 'kakao', async () => `${AUTH_REDIRECT}?code=x&state=other`, pkce, 's'),
  ).rejects.toThrow('로그인 응답이 맞지 않아요');
  expect(calls.some((c) => c.url.endsWith('/api/auth/exchange'))).toBe(false);
  expect(await sync.account()).toBeNull();
});

test('테마: 늦게 바꾼 쪽이 이긴다(계정이 더 늦으면 받아 오고, 이 기기가 더 늦으면 올린다)', async () => {
  let remote = { theme_id: '#87AA92' as string | null, theme_updated_at: 200 };
  const puts: unknown[] = [];
  const { repo, sync } = await engine((url, init) => {
    if (url.endsWith('/api/me/theme') && init?.method === 'PUT') {
      const b = JSON.parse(String(init.body));
      puts.push(b);
      remote = { theme_id: b.theme_id, theme_updated_at: b.updated_at };
      return remote;
    }
    if (url.endsWith('/api/me/theme')) return remote;
    return serverReply(url);
  });
  // 로그인 전에는 아무것도 하지 않는다
  expect(await sync.syncTheme({ accent: '#85ADE2', accentAt: 100 })).toBeNull();
  await repo.write(() => repo.setKv('account', { id: 'u1', email: '', token: 'tok', server: 'http://srv' }));
  // 다른 기기에서 더 늦게 바꿨으면 그 색을 받는다
  expect(await sync.syncTheme({ accent: '#85ADE2', accentAt: 100 })).toEqual({ accent: '#87AA92', accentAt: 200 });
  expect(puts).toEqual([]);
  // 이 기기가 더 늦게 바꿨으면 올린다(대문자로)
  expect(await sync.syncTheme({ accent: '#ff7f6b', accentAt: 300 })).toBeNull();
  expect(puts).toEqual([{ theme_id: '#FF7F6B', updated_at: 300 }]);
  // 같으면 아무것도 안 한다
  expect(await sync.syncTheme({ accent: '#FF7F6B', accentAt: 300 })).toBeNull();
  expect(puts.length).toBe(1);
});

test('account deletion clears local content, drafts and queued uploads only after acceptance', async () => {
  const { repo, sync, calls } = await engine(serverReply);
  await repo.addTodo('private task', null, 'bottom');
  await repo.write(async () => {
    await repo.setKv('account', { id: 'u1', email: 'review@example.test', token: 'tok', server: 'http://srv' });
    await repo.setKv('session', { drafts: { memo: 'private draft' } });
  });
  await sync.deleteAccount();
  expect(await sync.account()).toBeNull();
  expect((await repo.snapshot()).todos).toEqual([]);
  expect(await repo.outboxCount()).toBe(0);
  expect(await repo.getKv('session', null)).toBeNull();
  expect(calls.find((c) => c.url.endsWith('/api/me'))?.body).toEqual({ confirmation: 'DELETE' });
});

test('로그아웃은 돌던 동기화가 끝난 뒤에 계정을 떼어 낸다', async () => {
  const db = await memoryDb();
  const repo = new Repo(db, randomUUID); await repo.init();
  await repo.addTodo('처음', null, 'bottom');
  await repo.write(() => repo.setKv('account', { id: 'u1', email: '', token: 'tok', server: 'http://srv' }));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const order: string[] = [];
  const sync = new SyncEngine(repo, (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    order.push(path);
    if (path === '/api/sync/push') {
      await gate;
      order.push('push done');
      const { ops } = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ results: ops.map((o: { op_id: string }) => ({ op_id: o.op_id, status: 'ok' })) }));
    }
    return new Response(JSON.stringify(serverReply(url)));
  }) as typeof fetch, 'test');
  const syncing = sync.syncNow();
  await new Promise((r) => setTimeout(r, 10));
  const out = sync.logout();
  await new Promise((r) => setTimeout(r, 10));
  release();
  await Promise.all([syncing, out]);
  expect(order.indexOf('/api/auth/logout')).toBeGreaterThan(order.indexOf('push done'));
  expect(await sync.account()).toBeNull();
  expect(await repo.outboxCount()).toBe(0);
});

test('failed deletion preserves the local account and private records for retry', async () => {
  const db = await memoryDb();
  const repo = new Repo(db, randomUUID); await repo.init();
  await repo.addTodo('keep on failure', null, 'bottom');
  await repo.write(() => repo.setKv('account', { id: 'u1', token: 'tok', email: '', server: 'http://srv' }));
  const sync = new SyncEngine(repo, (async () => new Response('{}', { status: 503 })) as typeof fetch);
  await expect(sync.deleteAccount()).rejects.toThrow();
  expect(await sync.account()).not.toBeNull();
  expect((await repo.snapshot()).todos[0].text).toBe('keep on failure');
});

test('바로 받기: 서버가 바뀌었다고 답하면 바로 받고 다시 기다린다. 멈추면 끊고, 예전 서버(404)면 한동안 묻지 않는다', async () => {
  const db = await memoryDb();
  const repo = new Repo(db, randomUUID);
  await repo.init();
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
  let serverCursor = 5;
  let old = false;
  let wake: (() => void) | null = null;
  const urls: string[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    if (url.endsWith('/api/auth/exchange')) return json(user);
    if (url.includes('/api/sync/pull')) return json({ folders: [], todos: [], paragraphs: [], deleted: [], cursor: serverCursor, more: false, shared: [], foreign_ids: [] });
    if (url.includes('/api/sync/wait')) {
      if (old) return json({ error: 'not found' }, 404);
      if (Number(/since=(\d+)/.exec(url)![1]) < serverCursor) return json({ changed: true });
      // 바뀐 것이 없으면 다른 기기가 고치거나(wake) 앱이 끊을 때까지 기다린다
      return new Promise<Response>((resolve, reject) => {
        wake = () => resolve(json({ changed: true }));
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return json({ results: [] });
  }) as typeof fetch;
  const sync = new SyncEngine(repo, fakeFetch, 'test');
  const waits = (since?: number) => urls.filter((u) => u.includes(since == null ? '/api/sync/wait' : `/api/sync/wait?since=${since}`)).length;
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(ok()).toBe(true);
  };

  await sync.loginExternal('http://srv', 'google', async () => `${AUTH_REDIRECT}?code=c&state=s`, pkce, 's');
  // 앞에 있을 때만 건다(로그인만으로는 걸지 않는다)
  expect(waits()).toBe(0);
  sync.start(60_000, false);
  await until(() => waits(5) === 1);
  // 다른 기기가 고쳤다 → 바로 받아 오고(pull) 새 커서로 다시 기다린다
  const pulls = urls.filter((u) => u.includes('/api/sync/pull')).length;
  serverCursor = 9;
  wake!();
  await until(() => waits(9) === 1);
  expect(urls.filter((u) => u.includes('/api/sync/pull')).length).toBe(pulls + 1);
  // 뒤로 가면 끊는다
  sync.stop();
  await new Promise((r) => setTimeout(r, 20));
  expect(waits()).toBe(2);
  // 예전 서버(바로 받기 없음): 한 번 묻고는 주기 동기화만
  old = true;
  sync.start(60_000, false);
  await until(() => waits() === 3);
  sync.start(60_000, false);
  await new Promise((r) => setTimeout(r, 20));
  expect(waits()).toBe(3);
  sync.stop();
});

test('바로 받기: 기다리지 않고 바로 없다고 답하는 서버에는 쉬지 않고 다시 묻지 않는다', async () => {
  const db = await memoryDb();
  const repo = new Repo(db, randomUUID);
  await repo.init();
  const urls: string[] = [];
  const fakeFetch = (async (url: string) => {
    urls.push(url);
    if (url.endsWith('/api/auth/exchange')) return new Response(JSON.stringify(user));
    if (url.includes('/api/sync/pull')) return new Response(JSON.stringify({ folders: [], todos: [], paragraphs: [], deleted: [], cursor: 1, more: false, shared: [], foreign_ids: [] }));
    return new Response('{}');
  }) as typeof fetch;
  const sync = new SyncEngine(repo, fakeFetch, 'test');
  await sync.loginExternal('http://srv', 'kakao', async () => `${AUTH_REDIRECT}?code=c&state=s`, pkce, 's');
  sync.start(60_000, false);
  await new Promise((r) => setTimeout(r, 50));
  expect(urls.filter((u) => u.includes('/api/sync/wait')).length).toBe(1);
  sync.stop();
});

test('바로 받기가 중간에서 끊기면(프록시가 자름) 멈추지 않고 잠깐 쉬었다 다시 건다', async () => {
  const db = await memoryDb();
  const repo = new Repo(db, randomUUID);
  await repo.init();
  const urls: string[] = [];
  let cut = 2;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    if (url.endsWith('/api/auth/exchange')) return json({ token: 'tok', user: { id: 'u1', email: '' } });
    if (url.includes('/api/sync/pull')) return json({ folders: [], todos: [], paragraphs: [], deleted: [], cursor: 0, more: false, shared: [], foreign_ids: [] });
    if (url.includes('/api/sync/wait')) {
      // 처음 두 번은 게이트웨이가 자른다(504), 그 뒤로는 기다린다
      if (cut-- > 0) return json({ error: 'gateway' }, 504);
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    return json({ results: [] });
  }) as typeof fetch;
  const sync = new SyncEngine(repo, fakeFetch, 'test');
  sync.liveRetryMs = 1;
  await sync.loginExternal('http://srv', 'google', async () => `${AUTH_REDIRECT}?code=c&state=s`, pkce, 's');
  sync.start(60_000, false);
  const waits = () => urls.filter((u) => u.includes('/api/sync/wait')).length;
  for (let i = 0; i < 400 && waits() < 3; i++) await new Promise((r) => setTimeout(r, 5));
  // 두 번 잘려도 세 번째로 다시 걸려 있다(예전엔 첫 번째에서 멈추고 30초 주기 동기화를 기다렸다)
  expect(waits()).toBe(3);
  expect(urls.filter((u) => u.includes('/api/sync/wait')).every((u) => u.includes('max=25'))).toBe(true);
  sync.stop();
  await new Promise((r) => setTimeout(r, 20));
  expect(waits()).toBe(3);
});
