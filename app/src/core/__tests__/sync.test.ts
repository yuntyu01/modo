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

test('카카오: 시작 주소에 앱 주소·state·challenge를 싣고, 돌아온 code를 verifier와 함께 바꾼다', async () => {
  const { sync, calls } = await engine(serverReply);
  let opened = '';
  const acc = await sync.loginExternal('http://srv/', 'kakao', async (url, redirect) => {
    opened = url;
    expect(redirect).toBe(AUTH_REDIRECT);
    return `${AUTH_REDIRECT}?code=abc%2B1&state=st-1`;
  }, pkce, 'st-1');
  expect(opened.startsWith('http://srv/api/auth/kakao/start?')).toBe(true);
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
