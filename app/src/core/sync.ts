import { CodedError } from './errors';
import type { Repo } from './repo';
import type { EntityName, SharedFolder } from './types';

/** email은 카카오 계정이면 비어 있을 수 있다(이메일 동의를 안 했을 때). 그때는 name을 보여 준다. */
export type Account = { id: string; email: string; name?: string; token: string; server: string };

type AuthResponse = { token: string; user: { id: string; email: string; name?: string } };

/** 로그인 페이지를 열고, redirect로 돌아온 주소를 돌려준다(취소하면 null). 플랫폼마다 다르다(native/auth.ts). */
export type AuthBrowser = (url: string, redirect: string) => Promise<string | null>;
export type Pkce = { verifier: string; challenge: string };

/** 외부 로그인에서 브라우저가 돌아올 앱 주소(app.json scheme) */
export const AUTH_REDIRECT = 'modo://auth';

/** 'a=1&b=2' 꼴 쿼리(RN의 URL 구현에 기대지 않는다) */
function queryOf(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q = url.split('#')[0].split('?')[1] ?? '';
  for (const part of q.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}
const encodeQuery = (q: Record<string, string>) =>
  Object.entries(q)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

/** 사용자가 로그인 창을 닫음(오류로 보여 주지 않는다) */
export class AuthCancelled extends Error {}

/**
 * 화면이 쓰는 동기화 기능. 휴대폰은 SyncEngine이 그대로, PC 창은 메인 프로세스의 엔진에 IPC로 맡기는 대리(native/desktopSync.ts)가 따른다.
 */
export type SyncApi = Pick<
  SyncEngine,
  'status' | 'onStatus' | 'start' | 'stop' | 'schedule' | 'syncNow' | 'account' | 'login' | 'providers' | 'loginExternal' | 'logout' | 'deleteAccount' | 'syncTheme' | 'shareApi' | 'beginEdit' | 'endEdit'
>;

export type SyncStatus = {
  state: 'local' | 'idle' | 'syncing' | 'offline' | 'error' | 'expired';
  lastSyncAt: number | null;
  pending: number;
  message?: string;
  /** message의 오류 code(화면이 사용자 언어로 바꿔 보여 준다) */
  code?: string;
  rejected: number;
};

type Fetch = typeof fetch;

/** Release builds send account/content data only to the configured modo service. */
function serviceBase(server: string) {
  const base = server.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production' && base !== 'https://modo.kodeploy.com') {
    throw new HttpError(0, 'Please use the modo HTTPS service.', 'network');
  }
  return base;
}

/** status 0 = 연결 안 됨. code가 없던 예전 서버 응답은 상태 코드로 대신 정한다. */
export class HttpError extends CodedError {
  constructor(
    readonly status: number,
    message: string,
    code?: string,
  ) {
    super(code ?? (status === 0 ? 'network' : status >= 500 ? 'server' : 'request'), message);
  }
}

export async function api<T>(fetchFn: Fetch, server: string, path: string, init: RequestInit & { token?: string } = {}) {
  let res: Response;
  try {
    res = await fetchFn(serviceBase(server) + path, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
    });
  } catch {
    throw new HttpError(0, '서버에 연결할 수 없어요', 'network');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status, data?.error ?? `요청 실패 (${res.status})`, data?.code);
  return data as T;
}

/**
 * 로컬 우선 동기화.
 * push(오프라인 큐) → pull(커서 이후 변경) 순서. 실패하면 지수 백오프로 다시 시도한다.
 */
export class SyncEngine {
  private paused = false;
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private backoff = 0;
  private listeners = new Set<(s: SyncStatus) => void>();
  /** 지금 화면에서 편집 중인 항목 id(원격 text 반영을 미룬다) */
  readonly editing = new Set<string>();
  readonly deferred = new Map<string, { entity: EntityName; text: string }>();
  status: SyncStatus = { state: 'local', lastSyncAt: null, pending: 0, rejected: 0 };

  constructor(
    private repo: Repo,
    private fetchFn: Fetch = fetch,
    private device = 'device',
  ) {}

  onStatus(fn: (s: SyncStatus) => void) {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }
  /** 실제로 바뀐 것이 있을 때만 알린다(같은 상태를 30초마다 다시 알리면 상태를 보는 화면이 매번 다시 그려진다) */
  private setStatus(p: Partial<SyncStatus>) {
    const next = { ...this.status, ...p };
    if ((Object.keys(next) as (keyof SyncStatus)[]).every((k) => next[k] === this.status[k])) return;
    this.status = next;
    for (const fn of this.listeners) fn(this.status);
  }

  account() {
    return this.repo.getKv<Account | null>('account', null);
  }

  async login(server: string, email: string, password: string, register: boolean) {
    const r = await api<AuthResponse>(this.fetchFn, server, register ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, device: this.device }),
    });
    return this.adopt(server, r);
  }

  /** 서버가 켜 둔 로그인 수단 */
  async providers(server: string) {
    return api<{ password: boolean; kakao: boolean }>(this.fetchFn, server, '/api/auth/providers');
  }

  /**
   * 카카오 로그인: 서버가 카카오와 인가 코드를 주고받고, 앱에는 일회용 코드를 돌려준다.
   * 그 코드는 이 기기만 아는 PKCE verifier가 있어야 세션으로 바뀐다(다른 앱이 modo:// 주소를 가로채도 못 쓴다).
   */
  async loginExternal(server: string, provider: 'kakao', browser: AuthBrowser, pkce: Pkce, state: string) {
    const base = serviceBase(server);
    const url = `${base}/api/auth/${provider}/start?${encodeQuery({ redirect_uri: AUTH_REDIRECT, state, code_challenge: pkce.challenge })}`;
    const back = await browser(url, AUTH_REDIRECT);
    if (!back) throw new AuthCancelled();
    const q = queryOf(back);
    if (q.state !== state) throw new HttpError(400, '로그인 응답이 맞지 않아요. 다시 시도해 주세요', 'auth_mismatch');
    if (q.error === 'cancelled') throw new AuthCancelled();
    if (q.error === 'server') throw new HttpError(500, '서버 오류', 'server');
    if (q.error || !q.code) throw new HttpError(502, '카카오 로그인에 실패했어요. 잠시 후 다시 시도해 주세요', 'kakao_failed');
    const r = await api<AuthResponse>(this.fetchFn, server, '/api/auth/exchange', {
      method: 'POST',
      body: JSON.stringify({ code: q.code, code_verifier: pkce.verifier, device: this.device }),
    });
    return this.adopt(server, r);
  }

  /** 로그인 결과를 이 기기에 저장하고 첫 동기화(로그인 전 기록이 올라간다) */
  private async adopt(server: string, r: AuthResponse) {
    const acc: Account = { id: r.user.id, email: r.user.email ?? '', name: r.user.name ?? '', token: r.token, server };
    const prev = await this.repo.getKv<{ id: string } | null>('last_account_id', null);
    // 처음이거나 다른 계정이면 이 기기 기록을 전부 올린다. 같은 계정이면 쌓인 변경만 보내면 된다(로그아웃 중 고친 것 포함).
    if (prev?.id !== acc.id) await this.repo.reuploadAll();
    await this.repo.write(async () => {
      await this.repo.setKv('sync_cursor', 0);
      await this.repo.setKv('account', acc);
      await this.repo.setKv('last_account_id', { id: acc.id });
    });
    this.backoff = 0;
    await this.syncNow();
    return acc;
  }

  async logout() {
    // 돌던 동기화가 끝난 뒤 떼어 낸다. 도중에 떼면 받던 남의 공유 항목이 로그아웃 뒤에 다시 들어오고,
    // 보내던 op가 풀려 새 편집이 거기 합쳐졌다가 응답과 함께 지워진다.
    await this.detaching(async () => {
      const acc = await this.account();
      if (acc) {
        await api(this.fetchFn, acc.server, '/api/auth/logout', { method: 'POST', token: acc.token }).catch(() => {});
      }
      await this.repo.detachFromAccount();
      // last_account_id는 남긴다: 같은 계정으로 다시 들어오면 전부 다시 올리지 않는다
      await this.repo.write(() => this.repo.setKv('account', null));
      this.setStatus({ state: 'local', message: undefined, code: undefined });
    });
  }

  async deleteAccount() {
    if (this.paused) throw new Error('Account deletion is already in progress');
    const acc = await this.account();
    if (!acc) throw new HttpError(401, '로그인이 필요해요', 'login_required');
    await this.detaching(async () => {
      await api(this.fetchFn, acc.server, '/api/me', {
        method: 'DELETE', token: acc.token, body: JSON.stringify({ confirmation: 'DELETE' }),
      });
      await this.repo.eraseLocalData();
      this.editing.clear(); this.deferred.clear();
      this.setStatus({ state: 'local', pending: 0, rejected: 0, lastSyncAt: null, message: undefined, code: undefined });
    });
  }

  /** 계정을 떼어 내는 동안(로그아웃·계정 삭제): 새 동기화를 막고, 이미 보낸 동기화가 끝난 뒤 fn을 돌린다. */
  private async detaching(fn: () => Promise<void>) {
    if (this.paused) throw new Error('Account change is already in progress');
    this.paused = true;
    const wasPolling = this.interval != null;
    this.stop();
    try {
      await this.running;
      await fn();
    } finally {
      this.paused = false;
      if (wasPolling) this.start(30_000, false);
    }
  }

  /**
   * 앞에 있는 동안 주기적으로(기본 30초), 로컬 변경 뒤에는 조금 기다렸다가 동기화.
   * PC는 창이 모두 숨으면 간격을 늘린다(desktop/main.cjs). immediate=false면 지금 한 번 돌리지 않고 간격만 바꾼다.
   */
  start(every = 30_000, immediate = true) {
    this.stop();
    this.interval = setInterval(() => this.syncNow(), every);
    if (immediate) this.syncNow();
  }
  stop() {
    if (this.interval) clearInterval(this.interval);
    if (this.timer) clearTimeout(this.timer);
    this.interval = this.timer = null;
  }
  schedule(delay = 1500) {
    if (this.paused) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.syncNow(), delay);
  }

  /** 겹쳐 부르면 진행 중인 것이 끝난 뒤 한 번 더 돈다. */
  syncNow(): Promise<void> {
    if (this.paused) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.once();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async once() {
    const acc = await this.account();
    const pending = await this.repo.outboxCount();
    if (!acc) {
      this.setStatus({ state: 'local', pending });
      return;
    }
    this.setStatus({ state: 'syncing', pending });
    try {
      await this.pushAll(acc);
      await this.pullAll(acc);
      this.backoff = 0;
      this.setStatus({ state: 'idle', lastSyncAt: Date.now(), pending: await this.repo.outboxCount(), message: undefined, code: undefined });
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(-1, String(e), 'server');
      await this.repo.releaseOutbox();
      if (err.status === 401) {
        this.setStatus({ state: 'expired', message: '로그인이 만료됐어요. 다시 로그인해 주세요.', code: 'session_expired' });
        return;
      }
      this.setStatus({
        state: err.status === 0 ? 'offline' : 'error',
        message: err.message,
        code: err.code,
        pending: await this.repo.outboxCount(),
      });
      // 재접속 재시도: 2s, 4s, ... 최대 60s
      this.backoff = Math.min(this.backoff ? this.backoff * 2 : 2000, 60_000);
      this.schedule(this.backoff);
    }
  }

  private async pushAll(acc: Account) {
    for (;;) {
      const ops = await this.repo.takeOutbox(500);
      if (!ops.length) return;
      const r = await api<{ results: { op_id: string; status: string; message?: string }[] }>(
        this.fetchFn,
        acc.server,
        '/api/sync/push',
        {
          method: 'POST',
          token: acc.token,
          body: JSON.stringify({
            ops: ops.map((o) => ({ op_id: o.op_id, entity: o.entity, id: o.entity_id, create: o.is_create, fields: o.fields })),
          }),
        },
      );
      const rejected = r.results.filter((x) => x.status === 'forbidden' || x.status === 'invalid');
      if (rejected.length) {
        // 서버가 거절한 변경은 다음 pull에서 서버 상태로 되돌아간다. 몇 건인지 사용자에게 보여준다.
        this.setStatus({ rejected: this.status.rejected + rejected.length });
        await this.repo.write(() => this.repo.setKv('sync_cursor', 0));
      }
      await this.repo.ackOutbox(r.results.map((x) => x.op_id));
      // 서버에서 이미 영구 삭제된 항목(백업에서 되살렸거나 오래 꺼져 있던 기기): 여기서도 지운다
      const byOp = new Map(ops.map((o) => [o.op_id, o]));
      const gone = r.results.filter((x) => x.status === 'gone').map((x) => byOp.get(x.op_id)!).filter(Boolean);
      if (gone.length) await this.repo.applyRemote({ folders: [], todos: [], paragraphs: [], deleted: gone.map((o) => ({ id: o.entity_id, entity: o.entity })) }, this.editing, this.deferred);
    }
  }

  private async pullAll(acc: Account) {
    // 지난번 남의 항목 목록 요약: 서버의 것과 같으면 서버가 목록을 빼고 보낸다(빈 동기화마다 공유 폴더 항목 id를 다 받지 않게)
    const fd = await this.repo.getKv<string>('foreign_digest', '');
    for (;;) {
      const since = await this.repo.getKv<number>('sync_cursor', 0);
      const p = await api<{
        folders: Record<string, unknown>[];
        todos: Record<string, unknown>[];
        paragraphs: Record<string, unknown>[];
        deleted?: { id: string; entity: EntityName }[];
        cursor: number;
        more: boolean;
        shared: SharedFolder[];
        foreign_ids?: string[];
        foreign_digest?: string;
        foreign_same?: boolean;
      }>(this.fetchFn, acc.server, `/api/sync/pull?since=${since}&limit=1000${fd ? `&fd=${encodeURIComponent(fd)}` : ''}`, { token: acc.token });
      if (p.folders.length || p.todos.length || p.paragraphs.length || p.deleted?.length) {
        await this.repo.applyRemote(p, this.editing, this.deferred);
      }
      // 커서는 화면과 상관없는 kv라 바뀔 때만 쓴다(빈 동기화마다 쓰기 트랜잭션을 열지 않게)
      if (p.cursor !== since) await this.repo.write(() => this.repo.setKv('sync_cursor', p.cursor), 'remote');
      if (!p.more) {
        // foreign_same: 남의 항목 목록이 지난번과 같다(지울 것 없음, 공유 목록·권한만 맞춘다)
        const clean = await this.repo.sweepForeign(p.foreign_same ? null : (p.foreign_ids ?? []), p.shared);
        const digest = clean && p.foreign_digest ? p.foreign_digest : '';
        if (digest !== fd) await this.repo.write(() => this.repo.setKv('foreign_digest', digest), 'remote');
        return;
      }
    }
  }

  /** 편집 시작/끝을 알려 원격 반영 시점을 조절한다. */
  beginEdit(id: string) {
    this.editing.add(id);
  }
  async endEdit(id: string) {
    this.editing.delete(id);
    await this.repo.applyDeferred(id, this.deferred);
  }

  // ---------- 테마(계정에 지금 쓰는 테마색) ----------
  /**
   * 이 기기 테마색과 계정 테마를 맞춘다. 늦게 바꾼 쪽이 이긴다(바꾼 시각 밀리초).
   * 계정 쪽이 더 늦으면 그 값을 돌려주고(이 기기에 적용), 이 기기가 더 늦으면 올린다. 로그인 전이거나 실패하면 null.
   */
  async syncTheme(local: { accent: string; accentAt: number }): Promise<{ accent: string; accentAt: number } | null> {
    const acc = await this.account();
    if (!acc) return null;
    const remote = await api<{ theme_id: string | null; theme_updated_at: number }>(this.fetchFn, acc.server, '/api/me/theme', { token: acc.token });
    if (remote.theme_id && remote.theme_updated_at > local.accentAt) return { accent: remote.theme_id, accentAt: remote.theme_updated_at };
    const id = local.accent.toUpperCase();
    if (local.accentAt > remote.theme_updated_at && /^#[0-9A-F]{6}$/.test(id)) {
      await api(this.fetchFn, acc.server, '/api/me/theme', { method: 'PUT', token: acc.token, body: JSON.stringify({ theme_id: id, updated_at: local.accentAt }) });
    }
    return null;
  }

  // ---------- 공유 API ----------
  async shareApi<T>(path: string, init: RequestInit = {}) {
    const acc = await this.account();
    if (!acc) throw new HttpError(401, '로그인이 필요해요', 'login_required');
    return api<T>(this.fetchFn, acc.server, path, { ...init, token: acc.token });
  }
}
