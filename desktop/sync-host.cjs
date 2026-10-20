// PC 동기화는 Electron 메인 프로세스 한 곳에서만 돈다(예전에는 미니창·큰 창이 각자 엔진·서버 확인·테마 동기화를 따로 돌려
// 같은 요청이 창 수만큼 나갔고, 숨긴 미니창은 동기화가 멈췄다). 창은 IPC로 상태를 받고 명령만 보낸다(preload.cjs sync, app/src/native/desktopSync.ts).
// - 창을 닫거나 숨겨도 동기화는 계속된다. 보이는 창이 있으면 30초, 모두 숨으면 5분마다. 창을 다시 보이면 바로 한 번.
// - 저장소·동기화 코드는 휴대폰 앱과 같은 것(core.cjs = app/src/core 묶음)이라 오프라인 큐·중복 방지·충돌 사본·영구 삭제 규칙이 같다.
const { randomUUID } = require('node:crypto');
const { Repo, SyncEngine, AuthCancelled, touchesData, BRAND, SCHEMA_VERSION } = require('./core.cjs');

const VISIBLE_EVERY = 30_000;
const HIDDEN_EVERY = 5 * 60_000;

/** 메인에서 생긴 오류를 창으로 넘길 모양(클래스는 IPC를 건너지 못한다) */
function errorOf(e) {
  if (e instanceof AuthCancelled) return { kind: 'cancelled' };
  if (e && typeof e.status === 'number') return { kind: 'http', status: e.status, code: e.code, message: e.message };
  return { kind: 'error', code: e?.code, message: String(e?.message ?? e) };
}

/**
 * backupBeforeMigrate(fromVersion): 스키마 버전이 올라가는 첫 실행에서 고치기 전에 DB를 통째로 복사해 둔다(main.cjs가 VACUUM INTO로).
 * 되돌리는 법은 README '백업·복구'.
 */
function createSyncHost({ db, fetch, device, broadcast, hasVisibleWindow, openAuth, backupBeforeMigrate, afterAccountDeleted }) {
  const repo = new Repo(db, randomUUID);
  const engine = new SyncEngine(repo, fetch, device);
  let started = false;
  let defaultServer = 'https://modo.kodeploy.com';
  let server = { api: null, at: 0 };
  let probeTimer = null;
  let lastKick = 0;
  let lastTheme = 0;
  let themeTimer = null;

  // 메인이 받은 변경(할 일·메모·폴더·공유)을 모든 창에 알린다. kv(커서·요약 등)만 바뀐 것은 알리지 않는다:
  // 창이 다시 읽어야 하는 kv(테마색·계정)는 바꾸는 곳(themeSync·로그인·로그아웃)이 따로 알린다
  repo.subscribe((_source, tables) => {
    if (touchesData(tables)) broadcast('data-changed', [...tables]);
  });
  // 친구·요청 목록은 동기화(pull)로 kv 'friends'에 온다. kv는 알리지 않으니, 동기화가 끝났을 때 그 요약이 바뀌었으면 창에 알린다
  let friendsKey;
  const checkFriends = async () => {
    const f = await repo.getKv('friends', null);
    // 권한이 바뀌어 막힌 글(rejected_texts)이 있어도 알린다(창이 보관할지 묻는다)
    const lost = (await repo.getKv('rejected_texts', [])).length;
    const key = f ? `${f.account}:${f.digest}:${lost}` : `:${lost}`;
    if (key === friendsKey) return;
    friendsKey = key;
    broadcast('data-changed', ['friends']);
  };
  engine.onStatus((st) => {
    broadcast('sync:status', st);
    if (st.state === 'idle') checkFriends().catch(() => {});
    if (st.state === 'idle' && Date.now() - lastTheme > 60_000) themeSync();
  });

  async function serverUrl() {
    const acc = await engine.account();
    if (acc) return acc.server;
    const prefs = await repo.getKv('prefs', null);
    return prefs?.server ?? defaultServer;
  }

  // 서버가 닿는지(로그인 수단): 닿으면 10분, 안 닿으면 창이 보일 때 1분·숨었을 때 5분마다 다시 묻는다
  async function probe() {
    clearTimeout(probeTimer);
    let api = null;
    try {
      const p = await engine.providers(await serverUrl());
      api = { kakao: !!p.kakao, google: !!p.google, password: !!p.password };
    } catch {}
    const wasUp = !!server.api;
    server = { api, at: Date.now() };
    broadcast('server:state', server);
    // 끊겼다가 다시 닿으면 쌓아 둔 변경을 바로 보낸다
    if (api && !wasUp && (await engine.account())) engine.syncNow();
    probeTimer = setTimeout(probe, api ? 10 * 60_000 : hasVisibleWindow() ? 60_000 : HIDDEN_EVERY);
  }

  // 테마색을 계정과 맞춘다(늦게 바꾼 쪽이 이긴다). 동기화가 끝날 때 1분에 한 번까지, 창에서 테마색을 바꾸면 조금 뒤에
  // 마지막으로 서버에 보낸 테마색(설정을 바꿀 때 색이 그대로면 묻지 않는다)
  let lastLocal = null;
  const localTheme = async () => {
    const prefs = (await repo.getKv('prefs', null)) ?? {};
    return { prefs, local: { accent: prefs.accent ?? BRAND, accentAt: prefs.accentAt ?? 0 } };
  };
  const sameTheme = (a, b) => !!a && !!b && a.accent.toUpperCase() === b.accent.toUpperCase() && a.accentAt === b.accentAt;
  async function themeSync() {
    lastTheme = Date.now();
    if (!(await engine.account())) return;
    const { prefs, local } = await localTheme();
    lastLocal = local;
    const r = await engine.syncTheme(local).catch(() => null);
    if (!r) return;
    const next = { ...prefs, accentAt: r.accentAt };
    if (r.accent.toUpperCase() !== local.accent.toUpperCase()) next.accent = r.accent;
    lastLocal = { accent: next.accent ?? local.accent, accentAt: r.accentAt };
    await repo.write(() => repo.setKv('prefs', next));
    broadcast('data-changed', ['kv']);
  }

  // 지금 엔진에 준 간격. 같으면 다시 시작하지 않는다(창이 보이거나 숨거나 포커스될 때마다 불려, 30초 주기를 매번 처음부터 셌다)
  let currentEvery = 0;
  function applyInterval(immediate) {
    if (!started) return;
    const every = hasVisibleWindow() ? VISIBLE_EVERY : HIDDEN_EVERY;
    if (!immediate && every === currentEvery) return;
    currentEvery = every;
    engine.start(every, immediate);
  }

  // 창마다 고치는 중인 항목. 창이 닫히면(endEdit 없이) 메인 엔진의 '고치는 중'이 영영 남아 그 항목의 원격 변경이 미뤄졌다.
  // 같은 항목을 두 창이 고치면 둘 다 끝나야 푼다
  const edits = new Map(); // webContents id -> Set<항목 id>
  const editKey = (win) => win?.webContents?.id ?? 'none';
  const stillEditing = (id) => [...edits.values()].some((set) => set.has(id));
  async function endEditFor(key, id) {
    edits.get(key)?.delete(id);
    if (!stillEditing(id)) await engine.endEdit(id);
  }

  return {
    /** 창을 만들기 전에: 스키마 만들기·고치기, 보내다 만 op 다시 보내기 준비(창들은 outbox를 건드리지 않는다) */
    async init() {
      let prev = 0;
      try {
        prev = Number(JSON.parse((await db.all(`SELECT value FROM kv WHERE key = 'schema_version'`))[0]?.value ?? '0')) || 0;
      } catch {
        // 처음 실행(표가 아직 없다)
      }
      if (prev && prev < SCHEMA_VERSION && backupBeforeMigrate) await backupBeforeMigrate(prev);
      await repo.init({ owner: true });
    },
    /** 첫 동기화·서버 확인은 미니창이 뜬 뒤로 미룬다(네트워크가 메모·할 일 표시를 늦추지 않게) */
    begin(delayMs) {
      setTimeout(() => {
        started = true;
        applyInterval(true);
        probe();
      }, delayMs);
    },
    /** 창이 보이거나 숨었을 때: 간격을 바꾸고, 다시 보이면 바로 한 번(10초에 한 번까지) */
    windowsChanged(becameVisible) {
      if (!started) return;
      applyInterval(false);
      if (becameVisible && Date.now() - lastKick > 10_000) {
        lastKick = Date.now();
        engine.syncNow();
        if (Date.now() - server.at > 60_000) probe();
      }
    },
    /** 창이 할 일·메모를 고쳐 outbox에 넣었을 때 */
    localChange: () => engine.schedule(1500),
    /** 창이 테마색(prefs)을 바꿨을 때 */
    prefsChanged() {
      clearTimeout(themeTimer);
      // 투명도·언어처럼 테마색이 아닌 설정을 바꿨을 때는 서버에 묻지 않는다(예전엔 1.2초 뒤 매번 물었다)
      themeTimer = setTimeout(async () => {
        if (sameTheme((await localTheme()).local, lastLocal)) return;
        themeSync();
      }, 1200);
    },
    serverState: () => server,
    stop() {
      engine.stop();
      currentEvery = 0;
      clearTimeout(probeTimer);
      clearTimeout(themeTimer);
    },
    /** 창(webContents)이 사라졌을 때: 그 창이 고치던 항목을 푼다 */
    async windowGone(wcId) {
      const set = edits.get(wcId);
      if (!set) return;
      edits.delete(wcId);
      for (const id of set) if (!stillEditing(id)) await engine.endEdit(id).catch(() => {});
    },
    /** 창에서 온 명령. 결과는 { ok, value } 또는 { ok: false, error } */
    async call(win, method, args) {
      try {
        switch (method) {
          case 'status':
            return { ok: true, value: engine.status };
          case 'syncNow':
            await engine.syncNow();
            return { ok: true };
          case 'setDefaults':
            if (typeof args[0]?.server === 'string') defaultServer = args[0].server;
            return { ok: true };
          case 'providers':
            return { ok: true, value: await engine.providers(args[0]) };
          case 'login': {
            const acc = await engine.login(args[0], args[1], args[2], !!args[3]);
            broadcast('data-changed', ['*']);
            probe();
            return { ok: true, value: acc };
          }
          case 'loginExternal': {
            const [srv, provider, pkce, state] = args;
            const acc = await engine.loginExternal(srv, provider, (url, redirect) => openAuth(win, url, redirect), pkce, state);
            broadcast('data-changed', ['*']);
            probe();
            return { ok: true, value: acc };
          }
          case 'logout':
            await engine.logout();
            currentEvery = 0; // 엔진이 기본 간격으로 다시 시작한다 → 다음 창 변화에서 다시 맞춘다
            broadcast('data-changed', ['*']);
            return { ok: true };
          case 'deleteAccount':
            await engine.deleteAccount();
            currentEvery = 0;
            try { await afterAccountDeleted?.(); }
            finally { broadcast('data-changed', ['*']); }
            return { ok: true };
          case 'shareApi':
            return { ok: true, value: await engine.shareApi(args[0], args[1] ?? {}) };
          case 'probe':
            // 로그인 화면의 다시 시도: 지금 서버에 묻는다(결과는 server:state로 모든 창에)
            await probe();
            return { ok: true, value: server };
          case 'beginEdit': {
            const k = editKey(win);
            if (!edits.has(k)) edits.set(k, new Set());
            edits.get(k).add(String(args[0]));
            engine.beginEdit(String(args[0]));
            return { ok: true };
          }
          case 'endEdit':
            await endEditFor(editKey(win), String(args[0]));
            return { ok: true };
          default:
            return { ok: false, error: { kind: 'error', message: `unknown sync method ${method}` } };
        }
      } catch (e) {
        return { ok: false, error: errorOf(e) };
      }
    },
  };
}

module.exports = { createSyncHost };
