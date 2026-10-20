import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import type { Person } from '../core/types';
import { useApp } from './AppContext';

/** 친구와 함께 쓰는 폴더: mine = 내 폴더를 친구에게 공유한 것(아니면 친구가 내게 공유한 것). role은 그 공유의 권한 */
export type FriendFolder = { folder_id: string; role: 'view' | 'edit'; mine: boolean };
export type Friend = Person & { since: string; folders: FriendFolder[] };
export type FriendRequest = { id: string; user: Person; created_at: string };
export type FriendsData = { friends: Friend[]; incoming: FriendRequest[]; outgoing: FriendRequest[] };

type RequestResult = { status: 'requested' | 'accepted'; friend?: Person; request?: FriendRequest };

type FriendsApi = {
  data: FriendsData;
  /** 서버에서 한 번이라도 받았는지(아니면 마지막으로 받아 둔 목록) */
  loaded: boolean;
  refresh: () => Promise<void>;
  request: (email: string) => Promise<RequestResult>;
  accept: (id: string) => Promise<Person>;
  /** 받은 요청 거절 또는 보낸 요청 취소 */
  dismiss: (id: string) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  /** 친구에게 내 폴더 공유(사용자 id로: 이메일이 없는 계정도) */
  shareFolder: (folderId: string, userId: string, role: 'view' | 'edit') => Promise<void>;
};

const EMPTY: FriendsData = { friends: [], incoming: [], outgoing: [] };
const CACHE_KEY = 'friends_cache';
/** 받은 요청이 왔는지 보는 간격(앱이 앞에 있을 때만) */
const POLL_MS = 120_000;

const FriendsCtx = createContext<FriendsApi | null>(null);

/** 친구 목록은 이름·사람 표시용이라 이름이 없으면 이메일 앞부분 */
export function personName(p: Person) {
  return p.name.trim() || p.email.split('@')[0] || '?';
}

/** 시안의 '@harin': 이메일 앞부분(이메일이 없는 계정은 비움) */
export function personHandle(p: Person) {
  const local = p.email.split('@')[0];
  return local ? `@${local}` : '';
}

/**
 * 친구·받은 요청·보낸 요청과 친구별로 함께 쓰는 폴더. 서버(/api/friends)에서 받아 kv에 남겨 둔다:
 * 인터넷이 없을 때도 마지막 목록으로 함께 탭을 보여 준다(폴더 내용은 늘 이 기기의 DB).
 * 로그인한 화면(MainLayout) 안에서만 쓴다.
 */
export function FriendsProvider({ children }: { children: ReactNode }) {
  const { sync, repo, account, serverApi, snap } = useApp();
  const [data, setData] = useState<FriendsData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const accountId = account?.id ?? null;

  // 계정이 바뀌면 그 계정의 마지막 목록부터
  useEffect(() => {
    let alive = true;
    repo.getKv<{ account: string; data: FriendsData } | null>(CACHE_KEY, null).then((c) => {
      if (!alive) return;
      setData(c && c.account === accountId ? c.data : EMPTY);
      setLoaded(false);
    });
    return () => {
      alive = false;
    };
  }, [repo, accountId]);

  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (!accountId || busy.current) return;
    busy.current = true;
    try {
      const d = await sync.shareApi<FriendsData>('/api/friends');
      setData(d);
      setLoaded(true);
      await repo.write(() => repo.setKv(CACHE_KEY, { account: accountId, data: d }));
    } catch {
      // 인터넷이 없거나 예전 서버(친구 기능 없음): 마지막 목록 그대로
    } finally {
      busy.current = false;
    }
  }, [sync, repo, accountId]);

  // 서버에 닿을 때, 앞으로 올 때, 그리고 앱이 앞에 있는 동안 2분마다(받은 요청 표시). 공유가 바뀌면(폴더를 공유받음) 바로
  const sharedKey = snap.shared.map((s) => `${s.folder_id}:${s.role}`).join(',');
  useEffect(() => {
    if (!serverApi) return;
    // 상태는 서버 응답을 기다린 뒤에 바뀐다(컴파일러 규칙의 오탐)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [serverApi, refresh, sharedKey]);
  useEffect(() => {
    if (!serverApi) return;
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => void refresh(), POLL_MS);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        void refresh();
        timer ??= setInterval(() => void refresh(), POLL_MS);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [serverApi, refresh]);

  const api = useMemo<FriendsApi>(
    () => ({
      data,
      loaded,
      refresh,
      request: async (email) => {
        const r = await sync.shareApi<RequestResult>('/api/friends/requests', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
        await refresh();
        return r;
      },
      accept: async (id) => {
        const r = await sync.shareApi<{ friend: Person }>(`/api/friends/requests/${id}/accept`, { method: 'POST' });
        await refresh();
        return r.friend;
      },
      dismiss: async (id) => {
        await sync.shareApi(`/api/friends/requests/${id}`, { method: 'DELETE' });
        await refresh();
      },
      remove: async (userId) => {
        await sync.shareApi(`/api/friends/${userId}`, { method: 'DELETE' });
        await refresh();
      },
      shareFolder: async (folderId, userId, role) => {
        // 폴더가 서버에 올라가 있어야 공유할 수 있다
        await sync.syncNow();
        await sync.shareApi(`/api/folders/${folderId}/members`, { method: 'POST', body: JSON.stringify({ user_id: userId, role }) });
        await refresh();
      },
    }),
    [data, loaded, refresh, sync],
  );
  return <FriendsCtx.Provider value={api}>{children}</FriendsCtx.Provider>;
}

const NONE: FriendsApi = {
  data: EMPTY,
  loaded: false,
  refresh: async () => {},
  request: async () => ({ status: 'requested' }),
  accept: async () => ({ id: '', email: '', name: '' }),
  dismiss: async () => {},
  remove: async () => {},
  shareFolder: async () => {},
};

export function useFriends() {
  return useContext(FriendsCtx) ?? NONE;
}
