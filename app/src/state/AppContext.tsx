import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocales } from 'expo-localization';
import * as SplashScreen from 'expo-splash-screen';
import { AppState, Platform, Text, View, useColorScheme } from 'react-native';

import { openDb } from '../core/platform/openDb';
import { Repo, touchesData, type Touched } from '../core/repo';
import { applyLook, localLook, stampLook } from '../core/look';
import { SyncEngine, sameServerApi, serverApiOf, type Account, type SyncApi, type SyncStatus, type ServerApi } from '../core/sync';
import type { FolderFilter, Snapshot } from '../core/types';
import { resolveLang, translator, type Lang, type T } from '../i18n';
import { desktop, native } from '../native/bridge';
import { DesktopSync, desktopSyncBridge } from '../native/desktopSync';
import { isMiniWindow, makeTheme, type Theme } from '../ui/theme';
import { DEFAULT_PREFS, mergePrefs, type Prefs } from './prefs';
import { fmt } from '../core/repeat';

export type Toast = { message: string; action?: { label: string; run: () => void } };

type App = {
  repo: Repo;
  /** 휴대폰: 이 앱의 동기화 엔진. PC 창: 메인 프로세스의 엔진에 맡기는 대리(native/desktopSync.ts) */
  sync: SyncApi;
  snap: Snapshot;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  theme: Theme;
  t: T;
  /** 화면 언어(설정이 '시스템'이면 기기 언어에서 고른 것). 날짜·요일 표기에 쓴다 */
  lang: Lang;
  /** 오늘 'YYYY-MM-DD'. 날이 바뀌거나 앞으로 올 때 바뀐다(카드가 그릴 때마다 새 Date를 만들지 않고, 자정이 지나면 모든 카드가 한 번 다시 그려진다) */
  today: string;
  /** 지금 보는 폴더(null = 기본). 이 기기에서 마지막으로 쓴 폴더를 기억한다. */
  filter: FolderFilter;
  setFilter: (f: FolderFilter) => void;
  account: Account | null;
  refreshAccount: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  showToast: (t: Toast | null) => void;
  /** 편집기들이 등록하는 '지금 저장' 함수(백그라운드 전환·종료 직전에 호출) */
  registerFlush: (fn: () => Promise<void> | void) => () => void;
  flushAll: () => Promise<void>;
  /** 이 폴더에 내가 쓸 수 있는지(내 폴더·기본 폴더면 늘, 공유받은 폴더면 편집 권한일 때만) */
  canWrite: (folderId: string | null) => boolean;
  /**
   * 서버(API)에 닿는지와 켜 둔 로그인 수단. 닿지 않으면 null: 공유·계정·동기화처럼 서버가 있어야 하는 기능은 숨긴다.
   * 휴대폰은 앞으로 올 때마다·1분마다 묻고, PC는 메인 프로세스가 물어 알려 준다(sync-host.cjs).
   */
  serverApi: ServerApi | null;
  /** 서버에 닿는지 한 번이라도 물어 봤는지(그 전에는 로그인 화면이 '인터넷 없음' 대신 기다림을 보인다) */
  serverChecked: boolean;
  /** 지금 서버에 다시 묻는다(로그인 화면의 다시 시도) */
  recheckServer: () => Promise<void>;
};

const Ctx = createContext<App | null>(null);
/**
 * 자주 바뀌지 않는 것만(저장소·설정·테마·언어·토스트). 할 일 카드·메모처럼 많이 그려지는 곳은 useUi로 읽는다:
 * 앱 상태(useApp)는 저장할 때마다(snap) 바뀌어, 카드가 그걸 읽으면 글 하나를 고쳐도 모든 카드가 다시 그려졌다.
 */
type Ui = Pick<App, 'repo' | 'sync' | 'prefs' | 'setPrefs' | 'theme' | 't' | 'lang' | 'today' | 'showToast' | 'registerFlush' | 'flushAll'>;
const UiCtx = createContext<Ui | null>(null);
/**
 * 동기화 상태는 따로 둔다: 동기화가 돌 때마다(마지막 동기화 시각 등) 바뀌어, 앱 상태에 같이 두면 상태를 보지도 않는 화면 전체가
 * 30초마다 다시 그려졌다. 상태를 보여 주는 곳(설정의 내 계정)만 useSyncStatus로 읽는다.
 */
const StatusCtx = createContext<SyncStatus>({ state: 'local', lastSyncAt: null, pending: 0, rejected: 0 });

/**
 * 입력창 초안(폴더 × 모드). 글자를 칠 때마다 바뀌어서 앱 전체 상태(Ctx)와 따로 둔다:
 * 같이 두면 한 글자마다 화면의 모든 카드가 다시 그려진다.
 */
type Drafts = {
  draftOf: (folder: FolderFilter, todoMode: boolean) => string;
  setDraftOf: (folder: FolderFilter, todoMode: boolean, text: string) => void;
};
const DraftCtx = createContext<Drafts | null>(null);

/** 지금 뜬 토스트도 따로 둔다: 앱 상태에 두면 토스트가 뜨고 닫힐 때마다(할 일을 밀어 지울 때마다) 모든 카드가 다시 그려진다. */
const ToastCtx = createContext<Toast | null>(null);

const EMPTY: Snapshot = { folders: [], todos: [], paragraphs: [], shared: [] };

/** 이 기기에만 두는 화면 상태(마지막 폴더, 초안). 동기화하지 않는다. */
type Session = { lastFolder: string | null; drafts: Record<string, string> };
const draftKey = (folder: FolderFilter, todoMode: boolean) => `${folder ?? ''}|${todoMode ? 'todo' : 'memo'}`;
const liveFolder = (s: Snapshot, id: string | null) => !!id && s.folders.some((f) => f.id === id && !f.deleted_at);

function deviceName() {
  if (Platform.OS === 'web') return desktop?.platform === 'win32' ? 'Windows' : 'Desktop';
  return Platform.OS === 'ios' ? 'iPhone' : 'Android';
}

export function AppProvider({ children }: { children: ReactNode }) {
  const systemDark = useColorScheme() !== 'light';
  const [boot, setBoot] = useState<{ repo: Repo; sync: SyncApi } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [filter, setFilterState] = useState<FolderFilter>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const session = useRef<Session>({ lastFolder: null, drafts: {} });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ state: 'local', lastSyncAt: null, pending: 0, rejected: 0 });
  const [account, setAccount] = useState<Account | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [today, setToday] = useState(() => fmt(new Date()));
  const flushers = useRef(new Set<() => Promise<void> | void>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        const repo = new Repo(db, () => Crypto.randomUUID());
        // PC: 동기화·스키마 고치기는 메인 프로세스가 한 번만 한다(openDb가 그걸 기다린다). 창은 같은 고치기를 다시 하지 않고 outbox도 건드리지 않는다(repo.init 설명)
        const bridge = desktopSyncBridge();
        if (!bridge) await repo.init();
        const sync: SyncApi = bridge ? new DesktopSync(repo, bridge) : new SyncEngine(repo, fetch, deviceName());
        const saved = await repo.getKv<Partial<Prefs> | null>('prefs', null);
        const s = await repo.snapshot();
        const ses = await repo.getKv<Session | null>('session', null);
        if (cancelled) return;
        const merged = mergePrefs(saved);
        // 설정은 없어도 메모·할 일이 이미 있으면(예전 버전) 첫 실행 화면은 건너뛴다
        if (!saved && (s.todos.length || s.paragraphs.length)) merged.onboarded = true;
        setPrefsState(merged);
        // 설정 고치기(prefsVersion)가 돌았으면 위젯·빠른 추가도 읽도록 저장해 둔다(다음부터는 돌지 않는다)
        if (saved && saved.prefsVersion !== merged.prefsVersion) {
          await repo.write(() => repo.setKv('prefs', merged));
        }
        setSnap(s);
        // 첫 실행은 기본, 그 뒤엔 마지막으로 쓴 폴더. 지워졌거나 공유가 끊긴 폴더면 기본으로.
        session.current = { lastFolder: ses?.lastFolder ?? null, drafts: ses?.drafts ?? {} };
        setFilterState(liveFolder(s, session.current.lastFolder) ? session.current.lastFolder : null);
        setDrafts(session.current.drafts);
        setAccount(await sync.account());
        setBoot({ repo, sync });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 저장소 변경 → 화면 갱신, 동기화 예약, 위젯 갱신. 바뀐 표만 다시 읽고, 화면과 상관없는 쓰기(kv·outbox만)는 아무것도 하지 않는다
  useEffect(() => {
    if (!boot) return;
    const { repo, sync } = boot;
    let pending = false;
    const dirty = new Set<string>();
    let widgetTimer: ReturnType<typeof setTimeout> | null = null;
    // 다른 창에 알릴 표(위젯·다른 창 알림은 0.3초 모아서 한 번)
    const notify = new Set<string>();
    const reload = (tables?: Touched) => {
      for (const t of tables ?? ['*']) dirty.add(t);
      if (pending) return;
      pending = true;
      queueMicrotask(async () => {
        pending = false;
        const t = new Set(dirty);
        dirty.clear();
        setSnap(await repo.snapshot(t));
      });
    };
    const off = repo.subscribe((source, tables) => {
      // 할 일·메모를 고쳐 보낼 것이 생겼을 때만 동기화 예약(설정·화면 상태 저장은 보내지 않는다)
      if (source === 'local' && tables.has('outbox')) sync.schedule();
      if (!touchesData(tables)) return;
      reload(tables);
      for (const t of tables) notify.add(t);
      if (widgetTimer) clearTimeout(widgetTimer);
      // PC 다른 창은 0.3초 모아서, 휴대폰 위젯·알림 예약은 1초 모아서(메모를 쓰는 동안 저장될 때마다 위젯을 다시 그리지 않게)
      widgetTimer = setTimeout(
        () => {
          const tables = [...notify];
          notify.clear();
          // 바뀐 표를 알려 메모만 고쳤을 때는 알림 예약을 다시 하지 않게(예전엔 문단 하나를 고쳐도 Android가 알람 전부를 다시 잡았다)
          native.refresh(tables);
          desktop?.notifyDataChanged(tables);
        },
        desktop ? 300 : 1000,
      );
    });
    const offStatus = sync.onStatus(setStatus);
    // PC는 메인 프로세스가 동기화 주기를 정한다(창이 숨거나 닫혀도 계속)
    if (!desktop) sync.start();
    // 그날이 온 반복 할 일을 맨 위로(켤 때 · 앞으로 올 때 · 자정, repo.liftDueRepeats). 쓰면 위 subscribe가 다시 읽고 보낸다
    const lift = () => void repo.liftDueRepeats().catch(() => {});
    lift();
    // 위젯·빠른 추가·다른 창이 DB를 직접 바꿨을 수 있어 앞으로 올 때마다 다시 읽는다.
    // iOS는 뒤로 갈 때 inactive → background 두 번 알리고, 제어 센터·전화처럼 잠깐 inactive만 되기도 한다.
    // 저장(flush)은 처음 떠날 때 한 번, 보내기·주기 멈춤은 background에서 한 번만(예전엔 둘 다 두 번씩 돌았다)
    let was = AppState.currentState;
    const appState = AppState.addEventListener('change', async (st) => {
      const prev = was;
      was = st;
      if (st === 'active') {
        reload();
        setToday(fmt(new Date()));
        lift();
        if (!desktop && prev !== 'inactive') sync.start();
        return;
      }
      if (prev === 'active') {
        for (const fn of flushers.current) await fn();
        // 모아 두던 위젯 갱신은 앱이 멈추기 전에 바로(나가자마자 위젯이 옛 내용으로 남지 않게)
        if (widgetTimer && !desktop) {
          clearTimeout(widgetTimer);
          widgetTimer = null;
          native.refresh();
        }
      }
      if (st === 'background' && !desktop) {
        sync.syncNow();
        sync.stop();
      }
    });
    // 날이 바뀌면 다시 읽는다: 끝내 둔 반복 할 일이 그날 다시 올라오고 '오늘'·'내일' 표시도 바뀐다(창을 켜 둔 채로도)
    let dayTimer: ReturnType<typeof setTimeout> | null = null;
    const atMidnight = () => {
      const d = new Date();
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 2).getTime();
      dayTimer = setTimeout(() => {
        reload();
        setToday(fmt(new Date()));
        lift();
        atMidnight();
      }, next - d.getTime());
    };
    atMidnight();
    // PC: 다른 창(큰 창 ↔ 미니창)이나 메인 동기화가 바꾼 할 일과 설정(꾸미기의 라이트·다크, 계정 테마색)·계정을 바로 따라간다
    const offDesktop = desktop?.onDataChanged(async (tables?: string[]) => {
      const t = tables ? new Set(tables) : undefined;
      if (!t || touchesData(t)) reload(t);
      if (t && !t.has('*') && !t.has('kv')) return;
      const saved = await repo.getKv<Partial<Prefs> | null>('prefs', null);
      if (saved) setPrefsState(mergePrefs(saved));
      setAccount(await sync.account());
    });
    // PC: 창을 닫거나 앱을 끝내기 직전에 쓰던 글을 저장한다(메인이 요청하고 기다린다)
    const offFlush = desktop?.onFlushRequest?.(async () => {
      for (const fn of flushers.current) await fn();
    });
    // 빠른 추가·위젯 체크처럼 네이티브가 DB를 바꾸면 바로 다시 읽고 보낸다.
    const offNative = native.onDataChanged((tables) => {
      reload(tables?.length ? new Set(tables) : undefined);
      sync.schedule(500);
    });
    return () => {
      off();
      offStatus();
      appState.remove();
      if (dayTimer) clearTimeout(dayTimer);
      offDesktop?.();
      offFlush?.();
      offNative();
      if (!desktop) sync.stop();
    };
  }, [boot]);

  // 화면 상태는 변경 알림 없이 조용히 저장한다(동기화·위젯 갱신을 일으키지 않게).
  const persistSession = useCallback(
    (now?: boolean) => {
      if (!boot) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const save = () => boot.repo.read(() => boot.repo.setKv('session', session.current));
      if (now) return save();
      saveTimer.current = setTimeout(save, 500);
    },
    [boot],
  );
  useEffect(() => {
    if (!boot) return;
    flushers.current.add(() => persistSession(true));
  }, [boot, persistSession]);

  const setFilter = useCallback(
    (f: FolderFilter) => {
      setFilterState(f);
      session.current = { ...session.current, lastFolder: f };
      persistSession(true);
    },
    [persistSession],
  );
  const setDraftOf = useCallback(
    (folder: FolderFilter, todoMode: boolean, text: string) => {
      setDrafts((cur) => {
        const next = { ...cur };
        if (text) next[draftKey(folder, todoMode)] = text;
        else delete next[draftKey(folder, todoMode)];
        session.current = { ...session.current, drafts: next };
        return next;
      });
      persistSession();
    },
    [persistSession],
  );

  // 보던 폴더가 지워지거나 공유가 끊기면 기본으로 돌아간다. 새 폴더를 만들자마자 고른 경우
  // 스냅샷이 아직 옛것일 수 있어 폴더 선택이 아니라 스냅샷이 바뀔 때만 확인한다.
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);
  useEffect(() => {
    if (boot && filterRef.current && !liveFolder(snap, filterRef.current)) setFilter(null);
  }, [boot, snap, setFilter]);

  const prefsRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 설정 저장은 0.25초 모아서(슬라이더를 끄는 동안 움직일 때마다 저장하고 PC 다른 창에 알리던 것을 줄인다).
  // 화면은 바로 바뀌고, 앱이 뒤로 가거나 창을 닫기 전에는 바로 저장한다(flushers).
  // 저장할 때는 바뀐 항목만 저장된 설정 위에 덮어쓴다: PC는 미니창·큰 창이 각자 설정을 들고 있어, 전체를 통째로 쓰면
  // 다른 창이 방금 바꾼 항목(투명도 등)을 이 창의 옛 값으로 되돌렸다
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  const prefsSave = useRef<{ timer: ReturnType<typeof setTimeout> | null; patch: Partial<Prefs> | null }>({ timer: null, patch: null });
  const savePrefs = useCallback(async () => {
    const pending = prefsSave.current;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = null;
    const patch = pending.patch;
    pending.patch = null;
    if (!boot || !patch) return;
    await boot.repo.write(async () => {
      const saved = await boot.repo.getKv<Partial<Prefs> | null>('prefs', null);
      await boot.repo.setKv('prefs', { ...mergePrefs(saved), ...patch });
    });
    // 저장한 뒤 다른 창(PC 미니창 ↔ 큰 창)에 알린다. 휴대폰은 위젯 색·잠금화면 알림이 설정을 읽어 그리니 조금 모아 다시 그린다
    // (안 그러면 잠금화면 알림을 켜도 앱을 나가야 생겼다)
    desktop?.notifyDataChanged(['kv']);
    if (desktop) return;
    if (prefsRefresh.current) clearTimeout(prefsRefresh.current);
    prefsRefresh.current = setTimeout(() => native.refresh(), 500);
  }, [boot]);
  // 로그인·로그아웃하면 위젯·잠금화면 알림·할 일 알림을 다시 맞춘다(로그인하지 않았으면 위젯은 안내만, 알림은 내린다).
  // 계정은 kv라 데이터 변경 알림이 가지 않는다. 처음 켤 때는 네이티브 모듈이 따로 맞춘다
  const accountId = account?.id ?? null;
  const seenAccount = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!boot || desktop) return;
    if (seenAccount.current !== undefined && seenAccount.current !== accountId) native.refresh();
    seenAccount.current = accountId;
  }, [boot, accountId]);
  useEffect(() => {
    if (!boot) return;
    const set = flushers.current;
    set.add(savePrefs);
    return () => {
      set.delete(savePrefs);
    };
  }, [boot, savePrefs]);
  const setPrefs = useCallback(
    (p: Partial<Prefs>) => {
      const cur = prefsRef.current;
      const patch: Partial<Prefs> = { ...p };
      // 테마색을 바꾸면 바꾼 시각을 남긴다(계정 테마와 맞출 때 늦게 바꾼 쪽이 이긴다). 계정에서 받아 온 값은 그 시각을 그대로
      if (p.accent && p.accent !== cur.accent && p.accentAt === undefined) patch.accentAt = Date.now();
      // 꾸미기(화면 · 위젯 · PC 미니창)는 항목마다 바꾼 시각을 남겨 계정과 맞춘다(core/look.ts). 계정에서 받은 값은 그 시각을 그대로
      if (p.lookAts === undefined) {
        const ats = stampLook(cur, p, Date.now());
        if (ats) patch.lookAts = ats;
      }
      const next = { ...cur, ...patch };
      prefsRef.current = next;
      setPrefsState(next);
      const pending = prefsSave.current;
      pending.patch = { ...(pending.patch ?? {}), ...patch };
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = setTimeout(savePrefs, 250);
    },
    [savePrefs],
  );

  // 테마색을 계정과 맞춘다(휴대폰. PC는 메인 프로세스가 맡는다): 테마색을 바꾸면 조금 기다렸다 올리고, 동기화가 끝날 때마다(1분에 한 번까지) 다른 기기에서 바꾼 색을 받는다
  const themeRef = useRef({ accent: prefs.accent, accentAt: prefs.accentAt });
  useEffect(() => {
    themeRef.current = { accent: prefs.accent, accentAt: prefs.accentAt };
  }, [prefs.accent, prefs.accentAt]);
  const lastThemeSync = useRef(0);
  const syncTheme = useCallback(async () => {
    if (!boot) return;
    lastThemeSync.current = Date.now();
    const r = await boot.sync.syncTheme(themeRef.current).catch(() => null);
    if (r && r.accent.toUpperCase() !== themeRef.current.accent.toUpperCase()) setPrefs({ accent: r.accent, accentAt: r.accentAt });
    else if (r) setPrefs({ accentAt: r.accentAt });
  }, [boot, setPrefs]);
  useEffect(() => {
    if (!account || desktop) return;
    const timer = setTimeout(syncTheme, 1200);
    return () => clearTimeout(timer);
  }, [account, prefs.accent, prefs.accentAt, syncTheme]);
  useEffect(() => {
    if (account && !desktop && status.state === 'idle' && Date.now() - lastThemeSync.current > 300_000) syncTheme();
  }, [account, status.state, status.lastSyncAt, syncTheme]);
  // 앞으로 올 때도(다른 기기에서 바꾼 색을 바로 받게). 예전엔 켜 둔 동안 1분마다 물었다 → 5분마다 + 앞으로 올 때
  useEffect(() => {
    if (!account || desktop) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && Date.now() - lastThemeSync.current > 60_000) syncTheme();
    });
    return () => sub.remove();
  }, [account, syncTheme]);

  // 꾸미기 한 벌을 계정과 맞춘다(휴대폰. PC는 메인 프로세스가 맡는다): 휴대폰에서 PC 미니창을, PC에서 위젯을 고칠 수 있게
  // (사용자 요청 2026-10-24). 테마색과 같은 때에: 바꾸면 조금 기다렸다 올리고, 동기화가 끝날 때(5분에 한 번까지)·앞으로 올 때 받는다
  const lookRef = useRef(localLook(prefs));
  useEffect(() => {
    lookRef.current = localLook(prefs);
  }, [prefs]);
  const lastLookSync = useRef(0);
  const syncLook = useCallback(async () => {
    if (!boot) return;
    lastLookSync.current = Date.now();
    const r = await boot.sync.syncLook(lookRef.current).catch(() => null);
    if (!r) return;
    // 받은 항목과 그 시각만 덮는다(lookAts를 주면 setPrefs가 시각을 새로 찍지 않는다)
    const next = applyLook(prefsRef.current, r);
    setPrefs({ ...Object.fromEntries(Object.keys(r.v).map((k) => [k, next[k as keyof Prefs]])), lookAts: next.lookAts } as Partial<Prefs>);
  }, [boot, setPrefs]);
  useEffect(() => {
    if (!account || desktop) return;
    const timer = setTimeout(syncLook, 1200);
    return () => clearTimeout(timer);
  }, [account, prefs.lookAts, syncLook]);
  useEffect(() => {
    if (account && !desktop && status.state === 'idle' && Date.now() - lastLookSync.current > 300_000) syncLook();
  }, [account, status.state, status.lastSyncAt, syncLook]);
  useEffect(() => {
    if (!account || desktop) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && Date.now() - lastLookSync.current > 60_000) syncLook();
    });
    return () => sub.remove();
  }, [account, syncLook]);

  // 서버(API)가 닿는지: 로그인 수단을 물어 본다(로그인 화면·공유 버튼을 보일지 정한다)
  const [serverApi, setServerApi] = useState<ServerApi | null>(null);
  const serverUrl = account?.server ?? prefs.server;
  const [serverChecked, setServerChecked] = useState(false);
  // 처음엔 '닿는다'고 보고 시작한다: 켤 때 sync.start()가 바로 한 번 도는데, 첫 확인이 '다시 닿았다'로 보여 한 번 더 돌았다
  const reachable = useRef(true);
  const probeNow = useRef<() => Promise<void>>(async () => {});
  // PC: 메인 프로세스가 묻고 알려 준다(창마다 따로 묻지 않는다)
  useEffect(() => {
    const bridge = desktopSyncBridge();
    if (!boot || !bridge) return;
    bridge.call('setDefaults', [{ server: prefs.server }]);
    const apply = (st: { api: ServerApi | null; at: number }) => {
      if (!st.at) return; // 메인이 아직 묻기 전
      setServerApi((cur) => (sameServerApi(cur, st.api) ? cur : st.api));
      setServerChecked(true);
    };
    probeNow.current = async () => {
      await bridge.call('probe');
    };
    bridge.serverState().then(apply, () => {});
    return bridge.onServerState(apply);
  }, [boot, prefs.server]);
  useEffect(() => {
    if (!boot || desktop) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 닿으면 10분, 안 닿으면 1분 뒤에 다시(앞에 있는 동안만. 뒤로 가면 멈추고 앞으로 올 때 바로 묻는다)
    const next = () => {
      if (timer) clearTimeout(timer);
      if (alive && AppState.currentState === 'active') timer = setTimeout(probe, reachable.current ? 600_000 : 60_000);
    };
    const probe = () =>
      boot.sync
        .providers(serverUrl)
        .then((p) => {
          if (!alive) return;
          // 끊겼다가 다시 닿으면 쌓아 둔 변경을 바로 보낸다(동기화 재시도 간격을 기다리지 않게)
          if (!reachable.current) boot.sync.account().then((acc) => acc && boot.sync.syncNow());
          reachable.current = true;
          setServerApi((cur) => {
            const next = serverApiOf(p);
            return sameServerApi(cur, next) ? cur : next;
          });
          setServerChecked(true);
        })
        .catch(() => {
          if (!alive) return;
          reachable.current = false;
          setServerApi(null);
          setServerChecked(true);
        })
        .finally(next);
    probeNow.current = probe;
    probe();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') probe();
      else if (timer) clearTimeout(timer);
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [boot, serverUrl]);

  // PC 미니창은 미니창 설정(prefs.mini)으로 만든 테마를 쓴다. 예전엔 미니창 화면만 따로 만들고 그 안의 카드·입력창·편집기는 앱 테마를 읽어 서로 달랐다
  const theme = useMemo(() => makeTheme(prefs, systemDark, isMiniWindow() ? prefs.mini : undefined), [prefs, systemDark]);
  // 데스크톱(웹): 글자 선택 하이라이트를 테마색으로
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    let el = document.getElementById('selection-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'selection-style';
      document.head.appendChild(el);
    }
    // PC 글꼴: 글자 범위별로 나뉜 Pretendard. 화면에 실제로 나온 글자 범위만 불러온다.
    if (!document.getElementById('pretendard')) {
      const link = document.createElement('link');
      link.id = 'pretendard';
      link.rel = 'stylesheet';
      link.href = '/fonts/pretendard.css';
      document.head.appendChild(link);
    }
    // 스크롤 막대는 ui/thinScrollbar(3px, 올렸을 때만)가 맡는다. 여기 있던 8px 막대 규칙이 그걸 덮어써 두껍게 보였다
    el.textContent = `::selection{background:${theme.selection};color:inherit}*{caret-color:${theme.accent}}`;
  }, [theme.selection, theme.accent]);
  // 기기 언어는 바뀔 때만 다시 읽는다(useLocales). 예전엔 카드마다 그릴 때마다 getLocales()를 불렀다
  const locales = useLocales();
  const lang = useMemo(() => resolveLang(prefs.language, locales), [prefs.language, locales]);
  const t = useMemo(() => translator(lang), [lang]);
  // 친구가 공유한 '전체'의 이름을 화면 언어로('민지의 전체'). 휴대폰 엔진만(PC는 메인 프로세스 엔진이 한국어 기본값)
  useEffect(() => {
    if (boot?.sync instanceof SyncEngine) boot.sync.setBaseName((name) => t('friendBase', { name }));
  }, [boot, t]);
  const registerFlush = useCallback((fn: () => Promise<void> | void) => {
    flushers.current.add(fn);
    return () => flushers.current.delete(fn);
  }, []);
  const flushAll = useCallback(async () => {
    for (const fn of flushers.current) await fn();
  }, []);

  const ui = useMemo<Ui | null>(
    () => (boot ? { repo: boot.repo, sync: boot.sync, prefs, setPrefs, theme, t, lang, today, showToast: setToast, registerFlush, flushAll } : null),
    [boot, prefs, setPrefs, theme, t, lang, today, registerFlush, flushAll],
  );
  // 공유 목록(snap.shared)이 바뀔 때만 새 함수(메모·카드가 memo라 함수가 바뀌면 다시 그려진다)
  const canWrite = useCallback(
    (folderId: string | null) => {
      const shared = folderId ? snap.shared.find((s) => s.folder_id === folderId) : undefined;
      return !shared || shared.role === 'edit';
    },
    [snap.shared],
  );
  const value = useMemo<App | null>(() => {
    // ui 안의 함수(registerFlush 등)가 ref를 쓰지만 불릴 때 읽는다(아래 if (!value)와 같은 컴파일러 규칙의 오탐)
    // eslint-disable-next-line react-hooks/refs
    if (!boot || !ui) return null;
    return {
      ...ui,
      snap,
      filter,
      setFilter,
      account,
      refreshAccount: async () => setAccount(await boot.sync.account()),
      deleteAccount: async () => {
        await flushAll();
        await boot.sync.deleteAccount();
        if (saveTimer.current) clearTimeout(saveTimer.current);
        session.current = { lastFolder: null, drafts: {} };
        setDrafts({});
        setFilterState(null);
        setAccount(null);
        setPrefs({ lock: { enabled: false, visibility: 'private' } });
        // 위젯·잠금화면 알림이 설정을 읽기 전에 바로 저장
        await savePrefs();
        await native.refresh();
      },
      canWrite,
      serverApi,
      serverChecked,
      recheckServer: () => probeNow.current(),
    };
  }, [boot, ui, snap, filter, setFilter, account, flushAll, setPrefs, savePrefs, serverApi, serverChecked, canWrite]);
  const draftValue = useMemo<Drafts>(
    () => ({ draftOf: (folder, todoMode) => drafts[draftKey(folder, todoMode)] ?? '', setDraftOf }),
    [drafts, setDraftOf],
  );

  if (error) return <BootError message={error} />;
  // value 안의 함수(registerFlush 등)가 ref를 쓰지만 그리는 중이 아니라 불릴 때 읽는다(컴파일러 규칙의 오탐)
  // eslint-disable-next-line react-hooks/refs
  if (!value) return null;
  return (
    <UiCtx.Provider value={ui}>
    <Ctx.Provider value={value}>
      <StatusCtx.Provider value={status}>
        <DraftCtx.Provider value={draftValue}>
          <ToastCtx.Provider value={toast}>
            {children}
            <ReadyMark />
          </ToastCtx.Provider>
        </DraftCtx.Provider>
      </StatusCtx.Provider>
    </Ctx.Provider>
    </UiCtx.Provider>
  );
}

/** 첫 데이터로 화면이 그려진 다음 프레임 = 입력할 수 있는 때. 로딩 화면을 내리고, PC 성능 측정(desktop/bench.cjs)에 알린다 */
function ReadyMark() {
  useEffect(() => {
    SplashScreen.hide();
  }, []);
  useEffect(() => {
    if (!desktop?.perfMark) return;
    const id = requestAnimationFrame(() => desktop?.perfMark?.('interactive'));
    return () => cancelAnimationFrame(id);
  }, []);
  return null;
}

function BootError({ message }: { message: string }) {
  useEffect(() => {
    SplashScreen.hide();
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: '#fff', fontSize: 16 }}>저장소를 열지 못했어요</Text>
      <Text style={{ color: '#9C9FA6', marginTop: 8 }}>{message}</Text>
    </View>
  );
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

/** 저장소·설정·테마·언어처럼 자주 바뀌지 않는 것만(할 일 카드·메모처럼 많이 그려지는 곳) */
export function useUi() {
  const v = useContext(UiCtx);
  if (!v) throw new Error('useUi outside AppProvider');
  return v;
}

/** 동기화 상태(설정의 내 계정처럼 상태를 보여 주는 곳만) */
export function useSyncStatus() {
  return useContext(StatusCtx);
}

/** 지금 뜬 토스트(아래에 띄우는 ToastHost만) */
export function useToast() {
  return useContext(ToastCtx);
}

/** 초안 읽기·쓰기(입력창, 미리보기 카드, 메모의 입력 위치 표시만 쓴다) */
export function useDrafts() {
  const v = useContext(DraftCtx);
  if (!v) throw new Error('useDrafts outside AppProvider');
  return v;
}
