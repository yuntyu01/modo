// ELECTRON_RUN_AS_NODE=1 electron test/host.test.cjs (npm run test:unit)
// 메인 프로세스 동기화(sync-host.cjs)를 실제 SQLite 파일과 가짜 서버로 확인한다.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DesktopDb } = require('../db.cjs');
const { createSyncHost } = require('../sync-host.cjs');
const { Repo } = require('../core.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modo-host-'));
const raw = new DesktopDb(path.join(tmp, 'naegirok.db'));
// main.cjs mainDb()와 같은 모양(창이 없어 기다릴 차례가 없다)
const db = {
  all: async (sql, p = []) => raw.all(sql, p),
  run: async (sql, p = []) => raw.run(sql, p),
  exec: async (sql) => raw.exec(sql),
  transaction: async (fn) => {
    raw.exec('BEGIN IMMEDIATE');
    try {
      const r = await fn();
      raw.exec('COMMIT');
      return r;
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  },
};

// 가짜 서버: push한 op를 모으고, pull은 한 번만 다른 기기의 할 일 하나를 준다. up=false면 연결 안 됨
const server = { up: true, pushed: [], pulls: 0, remoteSent: false };
const remoteId = randomUUID();
async function fakeFetch(url, init) {
  if (!server.up) throw new TypeError('fetch failed');
  const u = new URL(url);
  const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.pathname === '/api/auth/providers') return json({ kakao: true, password: true });
  if (u.pathname === '/api/auth/login') return json({ token: 'tok', user: { id: 'u1', email: 'a@x', name: '' } });
  if (u.pathname === '/api/sync/push') {
    const ops = JSON.parse(init.body).ops;
    server.pushed.push(...ops);
    return json({ results: ops.map((o) => ({ op_id: o.op_id, status: 'ok' })) });
  }
  if (u.pathname === '/api/sync/pull') {
    server.pulls++;
    const todos = server.remoteSent
      ? []
      : [{ id: remoteId, folder_id: null, text: '다른 기기에서 쓴 할 일', position: 'a5', created_at: 1, updated_at: 1, done_at: null, due_date: null, remind_at: null, repeat_freq: null, repeat_days: null, done_log: null, deleted_at: null, conflict_of: null }];
    server.remoteSent = true;
    return json({ folders: [], todos, paragraphs: [], deleted: [], cursor: server.pulls, more: false, shared: [], foreign_ids: [], foreign_digest: '0-x' });
  }
  if (u.pathname === '/api/me/theme') return json({ theme_id: null, theme_updated_at: 0 });
  return json({});
}

const sent = [];
let deletedCleanup = 0;
const host = createSyncHost({
  db,
  fetch: fakeFetch,
  device: 'test',
  broadcast: (channel, payload) => sent.push({ channel, payload }),
  hasVisibleWindow: () => true,
  openAuth: async () => null,
  afterAccountDeleted: async () => { deletedCleanup++; },
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await wait(20);
  }
  return false;
};

(async () => {
  await host.init();
  // 창(같은 DB 파일의 다른 연결): 동기화하지 않는 연결로 init
  const win = new Repo(db, randomUUID);
  await win.init({ owner: false });

  host.begin(0);
  await until(() => sent.some((s) => s.channel === 'server:state'));
  const st = sent.find((s) => s.channel === 'server:state').payload;
  assert.deepStrictEqual(st.api, { kakao: true, google: false, password: true });
  assert.strictEqual(st.gate, true, '켤 때 서버가 바로 답하면 처음 로그인 화면을 띄울 수 있다');

  // '나중에': 다른 창에도 다시 띄우지 않게 알린다
  sent.length = 0;
  await host.call(null, 'deferLogin', []);
  assert.strictEqual(sent.find((s) => s.channel === 'server:state').payload.gate, false);

  // 로그인 → 모든 창에 알리고 첫 동기화(다른 기기의 할 일을 받아 창들에 '바뀐 표' 알림)
  sent.length = 0;
  const r = await host.call(null, 'login', ['http://srv', 'a@x', 'password123', false]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(await until(async () => (await win.snapshot()).todos.some((t) => t.id === remoteId)), '받은 할 일이 창 연결에서도 보인다');
  assert.ok(sent.some((s) => s.channel === 'data-changed' && s.payload.includes('todos')), '받은 변경을 창들에 알린다');

  // 창이 할 일을 만들면(창 연결로 쓰기) 메인이 알림을 받아 곧 보낸다(1.5초 뒤)
  const id = await win.addTodo('창에서 쓴 할 일', null, 'bottom');
  host.localChange();
  assert.ok(await until(() => server.pushed.some((o) => o.id === id), 4000), '창에서 쓴 할 일을 메인이 보낸다');

  // 연결이 끊긴 동안 쓴 것은 outbox에 남고, 다시 연결되면 보낸다(창을 다시 보일 때 바로 한 번)
  server.up = false;
  const off = await win.addTodo('오프라인에서 쓴 할 일', null, 'bottom');
  await host.call(null, 'syncNow', []);
  const [{ n }] = await db.all('SELECT COUNT(*) AS n FROM outbox');
  assert.ok(n >= 1, '끊긴 동안 쓴 것은 outbox에 남는다');
  server.up = true;
  host.windowsChanged(true);
  await host.call(null, 'syncNow', []);
  assert.ok(await until(() => server.pushed.some((o) => o.id === off)), '다시 연결되면 보낸다');
  assert.strictEqual(server.pushed.filter((o) => o.id === off).length, 1, '같은 op를 두 번 적용하지 않게 한 번만 보낸다');

  // 빈 동기화는 창들에 아무것도 알리지 않는다
  sent.length = 0;
  await host.call(null, 'syncNow', []);
  await host.call(null, 'syncNow', []);
  assert.ok(!sent.some((s) => s.channel === 'data-changed'), `빈 동기화 알림: ${JSON.stringify(sent)}`);

  server.up = false;
  assert.strictEqual((await host.call(null, 'deleteAccount', [])).ok, false);
  assert.ok(await win.getKv('account', null), 'failed deletion preserves account');
  assert.strictEqual(deletedCleanup, 0);
  server.up = true;
  assert.strictEqual((await host.call(null, 'deleteAccount', [])).ok, true);
  assert.strictEqual(deletedCleanup, 1, 'cleanup only after accepted server deletion');
  assert.strictEqual(await win.getKv('account', null), null);
  assert.strictEqual((await win.snapshot()).todos.length, 0, 'all windows see erased local records');
  assert.strictEqual((await db.all('SELECT COUNT(*) AS n FROM outbox'))[0].n, 0);
  host.stop();

  // 스키마 버전이 오르는 첫 실행: 고치기 전에 백업을 부른다(같은 버전이면 부르지 않는다)
  const backups = [];
  const raw2 = new DesktopDb(path.join(tmp, 'old.db'));
  const db2 = { ...db, all: async (q, p = []) => raw2.all(q, p), run: async (q, p = []) => raw2.run(q, p), exec: async (q) => raw2.exec(q), transaction: async (fn) => fn() };
  raw2.exec(`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO kv VALUES ('schema_version', '4');`);
  const h2 = createSyncHost({ db: db2, fetch: fakeFetch, device: 't', broadcast: () => {}, hasVisibleWindow: () => false, openAuth: async () => null, backupBeforeMigrate: async (v) => backups.push(v) });
  await h2.init();
  await h2.init();
  assert.deepStrictEqual(backups, [4], '버전이 오를 때 한 번만');
  raw2.close();

  raw.close();
  fs.rmSync(tmp, { recursive: true });
  console.log('sync-host: ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
