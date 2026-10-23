import type { Repo } from '../core/repo';
import { AuthCancelled, HttpError, type Account, type SyncApi, type SyncStatus, type ServerApi } from '../core/sync';
import { CodedError } from '../core/errors';

type CallResult = { ok: true; value?: unknown } | { ok: false; error: { kind: 'cancelled' | 'http' | 'error'; status?: number; code?: string; message?: string } };
export type ServerState = { api: ServerApi | null; at: number };
type Bridge = {
  call(method: string, args?: unknown[]): Promise<CallResult>;
  onStatus(fn: (s: SyncStatus) => void): () => void;
  serverState(): Promise<ServerState>;
  onServerState(fn: (s: ServerState) => void): () => void;
};

/** preload.cjs의 desktop.sync(Electron 메인 프로세스의 동기화, desktop/sync-host.cjs) */
export const desktopSyncBridge = (): Bridge | null =>
  typeof window !== 'undefined' ? ((window as { desktop?: { sync?: Bridge } }).desktop?.sync ?? null) : null;

/**
 * PC 창의 동기화: 엔진은 메인 프로세스 하나만 돈다(창 수만큼 요청·타이머가 생기지 않고, 창을 닫거나 숨겨도 계속된다).
 * 창은 상태를 받아 보여 주고 명령(지금 동기화·로그인·공유 API·편집 중 표시)만 보낸다. 주기·서버 확인·테마색 맞추기는 메인이 정한다.
 */
export class DesktopSync implements SyncApi {
  status: SyncStatus = { state: 'local', lastSyncAt: null, pending: 0, rejected: 0 };
  private listeners = new Set<(s: SyncStatus) => void>();

  constructor(
    private repo: Repo,
    private bridge: Bridge,
  ) {
    bridge.onStatus((s) => this.set(s));
    this.call<SyncStatus>('status').then((s) => s && this.set(s), () => {});
  }

  private set(s: SyncStatus) {
    this.status = s;
    for (const fn of this.listeners) fn(s);
  }
  private async call<T>(method: string, args: unknown[] = []): Promise<T> {
    const r = await this.bridge.call(method, args);
    if (r.ok) return r.value as T;
    const e = r.error;
    if (e.kind === 'cancelled') throw new AuthCancelled();
    if (e.kind === 'http') throw new HttpError(e.status ?? 0, e.message ?? '', e.code);
    throw new CodedError(e.code ?? 'server', e.message ?? '');
  }

  onStatus(fn: (s: SyncStatus) => void) {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }
  // 주기·창이 보일 때 한 번·로컬 변경 뒤 동기화는 메인이 알아서 한다(창이 고친 것은 커밋을 보고 안다)
  start() {}
  stop() {}
  schedule() {}
  syncNow() {
    return this.call<void>('syncNow');
  }
  account() {
    return this.repo.getKv<Account | null>('account', null);
  }
  login(server: string, email: string, password: string, register: boolean) {
    return this.call<Account>('login', [server, email, password, register]);
  }
  providers(server: string) {
    return this.call<{ password: boolean; kakao: boolean; google?: boolean }>('providers', [server]);
  }
  /** 로그인 창은 메인이 연다(browser는 쓰지 않는다) */
  loginExternal(server: string, provider: 'kakao' | 'google', _browser: unknown, pkce: { verifier: string; challenge: string }, state: string) {
    return this.call<Account>('loginExternal', [server, provider, pkce, state]);
  }
  logout() {
    return this.call<void>('logout');
  }
  deleteAccount() {
    return this.call<void>('deleteAccount');
  }
  /** 테마색은 메인이 동기화가 끝날 때·테마색을 바꿨을 때 맞추고 바뀌면 모든 창에 알린다 */
  async syncTheme() {
    return null;
  }
  /** 꾸미기도 메인이 테마색과 함께 맞추고(sync-host.cjs lookSync) 바뀌면 모든 창에 알린다 */
  async syncLook() {
    return null;
  }
  shareApi<T>(path: string, init: RequestInit = {}) {
    return this.call<T>('shareApi', [path, { method: init.method, body: init.body }]);
  }
  beginEdit(id: string) {
    this.call('beginEdit', [id]).catch(() => {});
  }
  endEdit(id: string) {
    return this.call<void>('endEdit', [id]);
  }
}
